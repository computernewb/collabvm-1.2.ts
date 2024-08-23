import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from 'fs';
import CollabVMServer from './CollabVMServer.js';

import { QemuVmDefinition } from '@computernewb/superqemu';

import AuthManager from './AuthManager.js';
import WSServer from './net/ws/WSServer.js';
import { User } from './User.js';
import TCPServer from './net/tcp/TCPServer.js';
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

let logger = pino();

logger.info('CollabVM Server starting up');

// Parse the config file

let Config: IConfig;

if (!fs.existsSync('config.toml')) {
	logger.error('Fatal error: Config.toml not found. Please copy config.example.toml and fill out fields');
	process.exit(1);
}
try {
	var configRaw = fs.readFileSync('config.toml').toString();
	Config = toml.parse(configRaw);
} catch (e) {
	logger.error('Fatal error: Failed to read or parse the config file: {0}', (e as Error).message);
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
	switch (Config.vm.type) {
		case 'qemu': {
			// Fire up the VM
			let def: QemuVmDefinition = {
				id: Config.collabvm.node,
				command: Config.qemu.qemuArgs,
				snapshot: Config.qemu.snapshots,
				forceTcp: false,
				vncHost: '127.0.0.1',
				vncPort: Config.qemu.vncPort,
			};

			VM = new QemuVMShim(def);
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
	TheProtocolManager.registerProtocol("guacamole", () => new GuacamoleProtocol);
	TheProtocolManager.registerProtocol("binary1", () => new BinRectsProtocol);

	await VM.Start();
	// Start up the server
	var CVM = new CollabVMServer(Config, VM, banmgr, auth, geoipReader);

	var WS = new WSServer(Config, banmgr);
	WS.on('connect', (client: User) => CVM.connectionOpened(client));
	WS.start();

	if (Config.tcp.enabled) {
		var TCP = new TCPServer(Config, banmgr);
		TCP.on('connect', (client: User) => CVM.connectionOpened(client));
		TCP.start();
	}
}
start();
