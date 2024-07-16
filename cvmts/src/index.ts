import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from 'fs';
import CollabVMServer from './CollabVMServer.js';

import { QemuVM, QemuVmDefinition } from '@computernewb/superqemu';

import AuthManager from './AuthManager.js';
import WSServer from './WebSocket/WSServer.js';
import { User } from './User.js';
import TCPServer from './TCP/TCPServer.js';
import VM from './VM.js';
import VNCVM from './VNCVM/VNCVM.js';
import GeoIPDownloader from './GeoIPDownloader.js';
import pino from 'pino';

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
	switch (Config.vm.type) {
		case 'qemu': {
			// Fire up the VM
			let def: QemuVmDefinition = {
				id: Config.collabvm.node,
				command: Config.qemu.qemuArgs,
				snapshot: Config.qemu.snapshots
			};

			VM = new QemuVM(def);
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

	await VM.Start();
	// Start up the server
	var CVM = new CollabVMServer(Config, VM, auth, geoipReader);

	var WS = new WSServer(Config);
	WS.on('connect', (client: User) => CVM.addUser(client));
	WS.start();

	if (Config.tcp.enabled) {
		var TCP = new TCPServer(Config);
		TCP.on('connect', (client: User) => CVM.addUser(client));
		TCP.start();
	}
}
start();
