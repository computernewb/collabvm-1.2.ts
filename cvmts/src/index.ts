import * as toml from 'toml';
import IConfig, { NodeConfiguration } from './IConfig.js';
import * as fs from 'fs';
import CollabVMServer from './CollabVMServer.js';
import AuthManager from './AuthManager.js';
import WSServer from './net/ws/WSServer.js';
import GeoIPDownloader from './GeoIPDownloader.js';
import pino from 'pino';
import { Database } from './Database.js';
import { BanManager } from './BanManager.js';
import { TheProtocolManager } from './protocol/Manager.js';
import { GuacamoleProtocol } from './protocol/GuacamoleProtocol.js';
import { BinRectsProtocol } from './protocol/BinRectsProtocol.js';
import { CollabVMNode } from './CollabVMNode.js';
import path from 'path';
import { NetworkServer } from './net/NetworkServer.js';

let logger = pino();
let Config: IConfig;
let CVM: CollabVMServer;
// This is an array to allow support for other layers again later, if desired
let networkLayers: NetworkServer[] = [];
let exiting = false;
let nodes = new Map<String, CollabVMNode>();

function parseTomlFile<T>(path: string) {
	try {
		var configRaw = fs.readFileSync(path).toString();
		return toml.parse(configRaw) as T;
	} catch (e) {
		logger.error({ err: e }, 'Fatal error: Failed to read or parse the config file');
		process.exit(1);
	}
}

async function stop() {
	if (exiting) return;
	exiting = true;

	await CVM.Stop();

	logger.info('CollabVM Server stopped');
	process.exit(0);
}

async function start() {
	logger.info('CollabVM Server starting up');

	if (!fs.existsSync('config.toml')) {
		logger.error('Fatal error: Config.toml not found. Please copy config.example.toml and fill out fields');
		process.exit(1);
	}

	Config = parseTomlFile<IConfig>('config.toml');

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

	process.on('SIGINT', async () => await stop());
	process.on('SIGTERM', async () => await stop());

	// Register protocol(s) that the server supports
	TheProtocolManager.registerProtocol('guacamole', () => new GuacamoleProtocol());
	TheProtocolManager.registerProtocol('binary1', () => new BinRectsProtocol());

	// Start up the server
	CVM = new CollabVMServer(Config, banmgr, auth, geoipReader, nodes, networkLayers);

	// Create nodes.
	for (let node of Config.collabvm.vms) {
		let nodePath = path.join(Config.collabvm.vmsDir, node);
		let nodeVMTomlPath = path.join(nodePath, 'vm.toml');

		if (!fs.existsSync(nodeVMTomlPath)) {
			logger.error({ node, expectedPath: nodeVMTomlPath }, 'Failed to find vm.toml for the following node. Please create it.');
			process.exit(1);
		}

		let nodeConfig = parseTomlFile<NodeConfiguration>(nodeVMTomlPath);

		// Make sure that there can't be a node which collides with an existing one.
		// If one is detected, we just exit, since it's probably a unintended configuration.
		if (nodes.has(nodeConfig.collabvm.node)) {
			logger.error({ collidingName: nodeConfig.collabvm.node, collidingPath: nodeVMTomlPath }, 'A node collision was detected in your configuration. Please review and fix accordingly.');
			process.exit(1);
		}

		nodes.set(nodeConfig.collabvm.node, new CollabVMNode(Config, nodeConfig, CVM));
	}

	// Bring up the network interfaces now
	networkLayers.push(new WSServer(Config, banmgr));

	// Bring up the server
	await CVM.Start();
}
start();
