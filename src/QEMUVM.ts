import { EventEmitter } from "events";
import IConfig from "./IConfig";
import * as rfb from 'rfb2';
import * as fs from 'fs';
import { spawn, ChildProcess } from "child_process";
import QMPClient from "./QMPClient";

export default class QEMUVM extends EventEmitter {
    vnc? : rfb.RfbClient;
    vncPort : number;
    qmpSock : string;
    qmpClient : QMPClient;
    qemuCmd : string;
    qemuProcess? : ChildProcess;
    qmpErrorLevel : number;
    vncErrorLevel : number;
    constructor(Config : IConfig) {
        super();
        if (Config.vm.vncPort < 5900) {
            console.error("[FATAL] VNC Port must be 5900 or higher");
            process.exit(1);
        }
        this.qmpSock = `${Config.vm.qmpSockDir}collab-vm-qmp-${Config.collabvm.node}.sock`;
        this.vncPort = Config.vm.vncPort;
        this.qemuCmd = `${Config.vm.qemuArgs} -snapshot -no-shutdown -vnc 127.0.0.1:${this.vncPort - 5900} -qmp unix:${this.qmpSock},server`;
        this.qmpErrorLevel = 0;
        this.vncErrorLevel = 0;
        this.qmpClient = new QMPClient(this.qmpSock);
        this.qmpClient.on('connected', () => this.qmpConnected());
    }

    Start() {
        return new Promise(async (res, rej) => {
            if (fs.existsSync(this.qmpSock))
                try {
                    fs.unlinkSync(this.qmpSock);
                } catch (e) {
                    console.error("[FATAL] Could not remove existing QMP socket: " + e);
                    process.exit(-1);
                }
            var qemuArr = this.qemuCmd.split(" ");
            this.qemuProcess = spawn(qemuArr[0], qemuArr.slice(1));
            process.on("beforeExit", () => {
                this.qemuProcess?.kill(9);
            });
            this.qemuProcess.stderr?.on('data', (d) => console.log(d.toString()));
            this.qemuProcess.on('spawn', () => {
                setTimeout(() => {
                    this.qmpClient.connect();
                }, 1000)
            });
        });
    }

    private qmpConnected() {
        console.log("QMP Connected");
        setTimeout(() => this.startVNC(), 1000);
    }

    private startVNC() {
        this.vnc = rfb.createConnection({
            host: "127.0.0.1",
            port: this.vncPort,
        });
    }

    private qmpClosed() {

    }
}