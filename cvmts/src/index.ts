import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from 'fs';
import CollabVMServer from './CollabVMServer.js';

import { QemuVmDefinition } from '@computernewb/superqemu';

import AuthManager from './AuthManager.js';
import WSServer from './net/ws/WSServer.js';
import { User } from './User.js';
import VM from './vm/interface.js';
import VNCVM from './vm/vnc/VNCVM.js';
import GeoIPDownloader from './GeoIPDownloader.js';
import pino from 'pino';
import { Database } from './Database.js';
import { BanManager } from './BanManager.js';
import { QemuVMShim } from './vm/qemu.js';
import { TheProtocolManager } from './protocol/Manager.js';
import { GuacamoleProtocol } from './protocol/GuacamoleProtocol.js';
import { BinRectsProtocol } from './protocol/BinRectsProtocol.js';
import { MetaApi } from './meta/metaApi.js';

let logger = pino();

logger.info('CollabVM Server starting up');

// Parse the config file

let confFile = process.argv[2] || 'config.toml';
let Config: IConfig;

if (!fs.existsSync(confFile)) {
	logger.error('Fatal error: '+confFile+' not found. Please copy config.example.toml and fill out fields');
	process.exit(1);
}
try {
	var configRaw = fs.readFileSync(confFile).toString();
	Config = toml.parse(configRaw);
} catch (e) {
	logger.error({ err: e }, 'Fatal error: Failed to read or parse the config file');
	process.exit(1);
}

let exiting = false;
let VM: VM;

async function stop() {
	if (exiting) return;
	exiting = true;
	await VM.Stop();
	process.exit(0);
}

async function start() {
	let geoipReader = null;
	if (Config.geoip.enabled) {
		let downloader = new GeoIPDownloader(Config.geoip.directory, Config.geoip.accountID, Config.geoip.licenseKey);
		geoipReader = await downloader.getGeoIPReader();
	}
	// Init the auth manager if enabled
	let auth = Config.auth.enabled ? new AuthManager(Config.auth.apiEndpoint, Config.auth.secretKey) : null;
	// Database and ban manager
	if (Config.bans.cvmban && !Config.mysql.enabled) {
		logger.error('MySQL must be configured to use cvmban.');
		process.exit(1);
	}
	if (!Config.bans.cvmban && !Config.bans.bancmd) {
		logger.warn('Neither cvmban nor ban command are configured. Bans will not function.');
	}
	let db = undefined;
	if (Config.mysql.enabled) {
		db = new Database(Config.mysql);
		await db.init();
	}
	let banmgr = new BanManager(Config.bans, db);

	// detect legacy vote config
	if (!Config.vote) {
		let resetVoteEnabled = Config.collabvm.voteTime != 0;
		Config.vote = {
			reset: { enabled: resetVoteEnabled, voteTime: Config.collabvm.voteTime || 0, voteCooldown: Config.collabvm.voteCooldown || 0 },
			reboot: { enabled: false, voteTime: 0, voteCooldown: 0 },
			iaosInsert: { enabled: false, voteTime: 0, voteCooldown: 0 },
			iaosEject: { enabled: false, voteTime: 0, voteCooldown: 0 }
		};
	}

	let meta: MetaApi | null = null;
	let metaEnabledFeatures: Array<string> = [];

	if (Config.meta?.enabled) {
		meta = new MetaApi(Config.meta.privateApi);
		metaEnabledFeatures = await meta.getEnabledFeatures();
	}

	if (Config.iaos?.enabled) {
		if (!meta) {
			logger.error('meta server is required for IAOS functionality');
			process.exit(1);
		} else if (metaEnabledFeatures.indexOf('iaos') === -1) {
			logger.error('meta server does not support IAOS functionality');
			process.exit(1);
		}
	}

	switch (Config.vm.type) {
		case 'qemu': {
			// Fire up the VM
			let def: QemuVmDefinition = {
				id: Config.collabvm.node,
				command: Config.qemu.qemuArgs,
				snapshot: Config.qemu.snapshots,
				forceTcp: false,
				vncHost: '127.0.0.1',
				vncPort: Config.qemu.vncPort
			};

			if (!Config.qemu.mediaDevices) {
				Config.qemu.mediaDevices = {};
			}

			VM = new QemuVMShim(def, Config.qemu.mediaDevices, Config.qemu.resourceLimits);
			break;
		}
		case 'vncvm': {
			VM = new VNCVM(Config.vncvm);
			break;
		}
		default: {
			logger.error(`Invalid VM type in config: ${Config.vm.type}`);
			process.exit(1);
			return;
		}
	}
	process.on('SIGINT', async () => await stop());
	process.on('SIGTERM', async () => await stop());

	// Register protocol(s) that the server supports
	TheProtocolManager.registerProtocol('guacamole', () => new GuacamoleProtocol());
	TheProtocolManager.registerProtocol('binary1', () => new BinRectsProtocol());

	// Start up the server
	var CVM = new CollabVMServer(Config, VM, banmgr, auth, geoipReader, meta);
	await VM.Start();

	var WS = new WSServer(Config, banmgr);
	WS.on('connect', (client: User) => CVM.connectionOpened(client));
	WS.start();
}
start();
