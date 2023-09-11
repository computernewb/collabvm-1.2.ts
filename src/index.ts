import * as toml from 'toml';
import IConfig from './IConfig.js';
import * as fs from "fs";
import WSServer from './WSServer.js';
import QEMUVM from './QEMUVM.js';
import log from './log.js';

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
    // Print a warning if qmpSockDir is set
    // and the host OS is Windows, as this
    // configuration will very likely not work.
    if(process.platform === "win32" && Config.vm.qmpSockDir) {
        log("WARN", "You appear to have the option 'qmpSockDir' enabled in the config.")
        log("WARN", "This is not supported on Windows, and you will likely run into issues.");
        log("WARN", "To remove this warning, use the qmpHost and qmpPort options instead.");
    }

    // Fire up the VM
    var VM = new QEMUVM(Config);
    await VM.Start();

    // Start up the websocket server
    var WS = new WSServer(Config, VM);
    WS.listen();
}
start();