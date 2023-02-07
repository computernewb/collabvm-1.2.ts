import { EventEmitter } from "events";
import IConfig from "./IConfig.js";
import * as rfb from 'rfb2';
import * as fs from 'fs';
import { execa, ExecaChildProcess } from "execa";
import QMPClient from "./QMPClient.js";

export default class QEMUVM extends EventEmitter {
    vnc? : rfb.RfbClient;
    vncPort : number;
    qmpSock : string;
    qmpClient : QMPClient;
    qemuCmd : string;
    qemuProcess? : ExecaChildProcess;
    qmpErrorLevel : number;
    vncErrorLevel : number;
    processRestartErrorLevel : number;
    expectedExit : boolean;
    vncOpen : boolean;

    vncReconnectTimeout? : NodeJS.Timer;
    qmpReconnectTimeout? : NodeJS.Timer;
    qemuRestartTimeout? : NodeJS.Timer;

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
        this.vncOpen = true;
        this.processRestartErrorLevel = 0;
        this.expectedExit = false;
        this.qmpClient = new QMPClient(this.qmpSock);
        this.qmpClient.on('connected', () => this.qmpConnected());
        this.qmpClient.on('close', () => this.qmpClosed());
    }

    Start() : Promise<void> {
        return new Promise<void>(async (res, rej) => {
            if (fs.existsSync(this.qmpSock))
                try {
                    fs.unlinkSync(this.qmpSock);
                } catch (e) {
                    console.error("[FATAL] Could not remove existing QMP socket: " + e);
                    process.exit(-1);
                }
            var qemuArr = this.qemuCmd.split(" ");
            this.qemuProcess = execa(qemuArr[0], qemuArr.slice(1));
            this.qemuProcess.catch(() => false);
            this.qemuProcess.stderr?.on('data', (d) => console.log(d.toString()));
            this.qemuProcess.once('spawn', () => {
                setTimeout(async () => {
                    await this.qmpClient.connect();
                }, 2000)
            });
            this.qemuProcess.once('exit', () => {
                if (this.expectedExit) return;
                clearTimeout(this.qmpReconnectTimeout);
                clearTimeout(this.vncReconnectTimeout);
                this.processRestartErrorLevel++;
                if (this.processRestartErrorLevel > 4) {
                    console.error("[FATAL] QEMU failed to launch 5 times.");
                    process.exit(-1);
                }
                console.warn("QEMU exited unexpectly. Restarting in 3 seconds...");
                this.qmpClient.disconnect();
                this.vnc?.end();
                this.qemuRestartTimeout = setTimeout(() => this.Start(), 3000);
            }); 
            this.qemuProcess.on('error', () => false);
            this.once('vncconnect', () => res());
        });
    }

    private qmpConnected() {
        this.qmpErrorLevel = 0;
        this.processRestartErrorLevel = 0;
        console.log("QMP Connected");
        setTimeout(() => this.startVNC(), 1000);
    }

    private startVNC() {
        this.vnc = rfb.createConnection({
            host: "127.0.0.1",
            port: this.vncPort,
        });
        this.vnc.on("close", () => this.vncClosed());
        this.vnc.on("connect", () => this.vncConnected());
        this.vnc.on("rect", (r) => this.onVNCRect(r));
        this.vnc.on("resize", (s) => this.onVNCSize(s));
    }

    getSize() {
        if (!this.vnc) return {height:0,width:0};
        return {height: this.vnc.height, width: this.vnc.width}
    }

    private qmpClosed() {
        if (this.expectedExit) return;
        this.qmpErrorLevel++;
        if (this.qmpErrorLevel > 4) {
            console.error("[FATAL] Failed to connect to QMP after 5 attempts");
            process.exit(1);
        }
        console.warn("Failed to connect to QMP. Retrying in 3 seconds...");
        this.qmpReconnectTimeout = setTimeout(() => this.qmpClient.connect(), 3000);
    }

    private vncClosed() {
        this.vncOpen = false;
        if (this.expectedExit) return;
        this.vncErrorLevel++;
        if (this.vncErrorLevel > 4) {
            console.error("[FATAL] Failed to connect to VNC after 5 attempts");
            process.exit(1);
        }
        try {
            this.vnc?.end();
        } catch {};
        console.warn("Failed to connect to VNC. Retrying in 3 seconds...");
        this.vncReconnectTimeout = setTimeout(() => this.startVNC(), 3000);
    }

    private vncConnected() {
        this.vncOpen = true;
        this.emit('vncconnect');
        this.vncErrorLevel = 0;
        //@ts-ignore
        this.onVNCSize({height: this.vnc.height, width: this.vnc.width});
    }
    private async onVNCRect(rect : any) {
        var buff = Buffer.alloc(rect.height * rect.width * 4)
        var offset = 0;
        for (var i = 0; i < rect.data.length; i += 4) {
            buff[offset++] = rect.data[i + 2];
            buff[offset++] = rect.data[i + 1];
            buff[offset++] = rect.data[i];
            buff[offset++] = 255;
        }
        this.emit("dirtyrect", buff, rect.x, rect.y, rect.width, rect.height);
        if (!this.vnc) throw new Error();
        if (this.vncOpen)
            this.vnc.requestUpdate(true, 0, 0, this.vnc.height, this.vnc.width);
    }

    private onVNCSize(size : any) {
        this.emit("size", {height: size.height, width: size.width});
    }

    Reboot() : Promise<void> {
        return this.qmpClient.reboot();
    }

    async Restore() {
        if (this.expectedExit) return;
        await this.Stop();
        this.expectedExit = false;
        this.Start();
    }

    Stop() : Promise<void> {
        return new Promise<void>(async (res, rej) => {
            if (this.expectedExit) {res(); return;}
            if (!this.qemuProcess) throw new Error("VM was not running");
            this.expectedExit = true;
            this.vncOpen = false;
            this.vnc?.end();
            var killTimeout = setTimeout(() => {
                console.log("Force killing QEMU after 10 seconds of waiting for shutdown");
                this.qemuProcess?.kill(9);
            }, 10000);
            var closep = new Promise<void>(async (reso, reje) => {
                this.qemuProcess?.once('exit', () => reso());
                await this.qmpClient.execute({ "execute": "quit" });
            });
            var qmpclosep = new Promise<void>((reso, rej) => {
                this.qmpClient.once('close', () => reso());
            });
            await Promise.all([closep, qmpclosep]);
            clearTimeout(killTimeout);
            res();
        })
    }
}