import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from 'fs';
import WSServer from './WSServer.js';

import { QemuVM, QemuVmDefinition } from '@cvmts/qemu';

import * as Shared from '@cvmts/shared';
import AuthManager from './AuthManager.js';

let logger = new Shared.Logger('CVMTS.Init');

logger.Info('CollabVM Server starting up');

// Parse the config file

let Config: IConfig;

if (!fs.existsSync('config.toml')) {
	logger.Error('Fatal error: Config.toml not found. Please copy config.example.toml and fill out fields');
	process.exit(1);
}
try {
	var configRaw = fs.readFileSync('config.toml').toString();
	Config = toml.parse(configRaw);
} catch (e) {
	logger.Error('Fatal error: Failed to read or parse the config file: {0}', (e as Error).message);
	process.exit(1);
}

async function start() {
	// Print a warning if qmpSockDir is set
	// and the host OS is Windows, as this
	// configuration will very likely not work.
	if (process.platform === 'win32' && Config.vm.qmpSockDir) {
		logger.Warning("You appear to have the option 'qmpSockDir' enabled in the config.");
		logger.Warning('This is not supported on Windows, and you will likely run into issues.');
		logger.Warning('To remove this warning, use the qmpHost and qmpPort options instead.');
	}

	// Init the auth manager if enabled
	let auth = Config.auth.enabled ? new AuthManager(Config.auth.apiEndpoint, Config.auth.secretKey) : null;

	// Fire up the VM
	let def: QemuVmDefinition = {
		id: Config.collabvm.node,
		command: Config.vm.qemuArgs
	};

	var VM = new QemuVM(def);
	await VM.Start();

	// Start up the websocket server
	var WS = new WSServer(Config, VM, auth);
	WS.listen();
}
start();
