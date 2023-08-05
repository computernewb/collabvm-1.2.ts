import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from "fs";
import WSServer from './WSServer.js';
import QEMUVM from './QEMUVM.js';
import VNCVM from './VNCVM.js';
import log from './log.js';
import VM from './VM.js';

log("INFO", "CollabVM Server starting up");

// Parse the config file

var Config : IConfig;

if (!fs.existsSync("config.toml")) {
    log("FATAL", "Config.toml not found. Please copy config.example.toml and fill out fields")
    process.exit(1);
}
try {
    var configRaw = fs.readFileSync("config.toml").toString();
    Config = toml.parse(configRaw);
} catch (e) {
    log("FATAL", `Failed to read or parse the config file: ${e}`);
    process.exit(1);
}


async function start() {
    // Fire up the VM
    var VM : VM;
    switch (Config.vm.hypervisor) {
        case "vnc":
            VM = new VNCVM(Config);
            break;
        case "qemu":
        default: // Do not break existing setups
            VM = new QEMUVM(Config);
    }
    await VM.Start();

    // Start up the websocket server
    var WS = new WSServer(Config, VM);
    WS.listen();
}
start();