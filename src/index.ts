import * as toml from 'toml';
import IConfig from './IConfig';
import * as fs from "fs";
import WSServer from './WSServer';
import QEMUVM from './QEMUVM';

// Parse the config file

var Config : IConfig;

if (!fs.existsSync("config.toml")) {
    console.error("config.toml not found. Please copy config.example.toml to config.toml and fill out fields.");
    process.exit(1);
}
try {
    var configRaw = fs.readFileSync("config.toml").toString();
    Config = toml.parse(configRaw);
} catch (e) {
    console.error(`Failed to read or parse the config file: ${e}`);
    process.exit(1);
}

// Fire up the VM
var VM = new QEMUVM(Config);
VM.Start();

// Start up the websocket server
var WS = new WSServer(Config);
WS.listen();