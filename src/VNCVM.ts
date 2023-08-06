import { EventEmitter } from "events";
import IConfig from "./IConfig.js";
import * as rfb from 'rfb2';
import * as fs from 'fs';
import { execa, ExecaChildProcess, execaCommand } from "execa";
import BatchRects from "./RectBatcher.js";
import { createCanvas, Canvas, CanvasRenderingContext2D, createImageData } from "canvas";
import { Mutex } from "async-mutex";
import log from "./log.js";
import VM from "./VM.js";

export default class VNCVM extends VM {
    vnc? : rfb.RfbClient;
    vncPort : number;
    vncPassword? : string;
    framebuffer : Canvas;
    framebufferCtx : CanvasRenderingContext2D;
    startCmd : string;
    stopCmd? : string;
    rebootCmd? : string;
    startProcess? : ExecaChildProcess;
    vncErrorLevel : number;
    processRestartErrorLevel : number;
    expectedExit : boolean;
    vncOpen : boolean;
    vncUpdateInterval? : NodeJS.Timer;
    rects : {height:number,width:number,x:number,y:number,data:Buffer}[];
    rectMutex : Mutex;

    vncReconnectTimeout? : NodeJS.Timer;
    processRestartTimeout? : NodeJS.Timer;

    constructor(Config : IConfig) {
        super();
        this.vncPort = Config.vm.vncPort;
        this.startCmd = Config.vm.startCmd?.replace(/\$VNCPORT/,this.vncPort.toString()) || '';
        this.stopCmd = Config.vm.stopCmd || '';
        this.rebootCmd = Config.vm.rebootCmd || '';
        this.vncPassword = Config.vm.vncPass || undefined;
        this.vncErrorLevel = 0;
        this.vncOpen = true;
        this.rects = [];
        this.rectMutex = new Mutex();
        this.framebuffer = createCanvas(1, 1);
        this.framebufferCtx = this.framebuffer.getContext("2d");
        this.processRestartErrorLevel = 0;
        this.expectedExit = false;
    }

    Start() : Promise<void> {
        return new Promise<void>(async (res, rej) => {
            if (!this.startCmd) {
                this.startVNC();
                res();
                return;
            }
            this.startProcess = execaCommand(this.startCmd,{shell:true});
            this.startProcess.catch(() => false);
            this.startProcess.stderr?.on('data', (d) => log("ERROR", `Process sent to stderr: ${d.toString()}`));
            this.startProcess.once('spawn', () => {
                setTimeout(() => this.startVNC(), 1000);
            });
            this.startProcess.once('exit', () => {
                if (this.expectedExit) return;
                if (this.stopCmd) return;
                clearTimeout(this.vncReconnectTimeout);
                this.processRestartErrorLevel++;
                if (this.processRestartErrorLevel > 4) {
                    log("FATAL", "Process failed to launch 5 times.");
                    process.exit(-1);
                }
                log("WARN", "Process exited unexpectedly, retrying in 3 seconds");
                this.vnc?.end();
                this.processRestartTimeout = setTimeout(() => this.Start(), 3000);
            }); 
            this.startProcess.on('error', () => false);
            this.once('vncconnect', () => res());
        });
    }

    private startVNC() {
        this.vnc = rfb.createConnection({
            host: "127.0.0.1",
            port: this.vncPort,
            password: this.vncPassword,
            encodings: [
                0, // raw
                1, // copyrect
                -223 // resize
            ]
        });
        this.vnc.on("close", () => this.vncClosed());
        this.vnc.on("error", (err) => {log('ERROR','VNC Error: '+err);});
        this.vnc.on("connect", () => this.vncConnected());
        this.vnc.on("rect", (r) => this.onVNCRect(r));
        this.vnc.on("resize", (s) => this.onVNCSize(s));
    }

    public getSize() {
        if (!this.vnc) return {height:0,width:0};
        return {height: this.vnc.height, width: this.vnc.width}
    }


    private vncClosed() {
        this.vncOpen = false;
        if (this.expectedExit) return;
        this.vncErrorLevel++;
        if (this.vncErrorLevel > 4) {
            log("FATAL", "Failed to connect to VNC after 5 attempts.")
            process.exit(1);
        }
        try {
            this.vnc?.end();
        } catch {};
        log("ERROR", "Failed to connect to VNC, retrying in 3 seconds");
        this.vncReconnectTimeout = setTimeout(() => this.startVNC(), 3000);
    }

    private vncConnected() {
        this.vncOpen = true;
        this.emit('vncconnect');
        log("INFO", "VNC Connected");
        this.vncErrorLevel = 0;
        //@ts-ignore
        this.onVNCSize({height: this.vnc.height, width: this.vnc.width});
        this.vncUpdateInterval = setInterval(() => this.SendRects(), 33);
    }
    private onVNCRect(rect : any) {
        return this.rectMutex.runExclusive(async () => {
            return new Promise<void>(async (res, rej) => {
                switch (rect.encoding) {
                    case 0: // raw
                        var buff = Buffer.alloc(rect.height * rect.width * 4)
                        var offset = 0;
                        for (var i = 0; i < rect.data.length; i += 4) {
                            buff[offset++] = rect.data[i + 2];
                            buff[offset++] = rect.data[i + 1];
                            buff[offset++] = rect.data[i];
                            buff[offset++] = 255;
                        }
                        var imgdata = createImageData(Uint8ClampedArray.from(buff), rect.width, rect.height);
                        this.framebufferCtx.putImageData(imgdata, rect.x, rect.y);
                        this.rects.push({
                            x: rect.x,
                            y: rect.y,
                            height: rect.height,
                            width: rect.width,
                            data: buff,
                        });
                        if (!this.vnc) throw new Error();
                        if (this.vncOpen)
                            this.vnc.requestUpdate(true, 0, 0, this.vnc.width, this.vnc.height);
                        res();
                        break;
                    case 1: // copyrect
                        // this.emit('copy',{width: rect.width, height: rect.height, srcX: rect.src.x, srcY: rect.src.y, destX: rect.x, destY: rect.y}) // todo: add this when webapp supports copyrect natively
                        let imgData = this.framebufferCtx.getImageData(rect.src.x,rect.src.y,rect.width,rect.height);
                        this.framebufferCtx.putImageData(imgData, rect.x, rect.y);
                        this.rects.push({
                            x: rect.x,
                            y: rect.y,
                            height: rect.height,
                            width: rect.width,
                            data: Buffer.from(imgData.data),
                        });
                        if (!this.vnc) throw new Error();
                        if (this.vncOpen)
                            this.vnc.requestUpdate(true, 0, 0, this.vnc.width, this.vnc.height);
                        res();
                        break;
                    default:
                        res(); // ignore other encodings
                }
            })
        });
    }

    SendRects() {
        if (!this.vnc || this.rects.length < 1) return;
        return this.rectMutex.runExclusive(() => {
            return new Promise<void>(async (res, rej) => {
                var rect = await BatchRects(this.framebuffer, [...this.rects]);
                this.rects = [];
                this.emit('dirtyrect', rect.data, rect.x, rect.y);
                res();
            });
        })
    }

    private onVNCSize(size : any) {
        if (this.framebuffer.height !== size.height) this.framebuffer.height = size.height;
        if (this.framebuffer.width !== size.width) this.framebuffer.width = size.width;
        if (!this.vnc) throw new Error();
        if (this.vncOpen)
            this.vnc.requestUpdate(true, 0, 0, this.vnc.width, this.vnc.height);
        this.emit("size", {height: size.height, width: size.width});
    }

    Reboot() : Promise<void> {
        return new Promise(async (res, rej) => {
            if (this.expectedExit) {res(); return;}
            if (this.rebootCmd) execaCommand(this.rebootCmd,{shell:true}).catch(() => false);
        });
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
            if (!this.startCmd) {this.expectedExit = true; this.vncOpen = false; this.vnc?.end(); res(); return;}
            if (!this.startProcess && !this.stopCmd) throw new Error("VM was not running");
            this.expectedExit = true;
            this.vncOpen = false;
            this.vnc?.end();
            clearInterval(this.vncUpdateInterval);
            var killTimeout = setTimeout(() => {
                log("WARN", "Force killing the process after 10 seconds of waiting for shutdown");
                this.startProcess?.kill(9);
            }, 10000);
            var closep = new Promise<void>(async (reso, reje) => {
                if (this.startProcess?.exitCode != null) return reso();
                this.startProcess?.once('exit', () => reso());
                this.startProcess?.kill(2);
            });
            var stopp = new Promise<void>((reso, rej) => {
                if (!this.stopCmd) return reso();
                let stopProc = execaCommand(this.stopCmd, { shell: true });
                stopProc.once('exit',()=>{
                    reso();
                })
                stopProc.catch(() => false);
            });
            await Promise.all([closep,stopp]);
            clearTimeout(killTimeout);
            res();
        })
    }

    public pointerEvent(x: number, y: number, mask: number) {
        if (!this.vnc) throw new Error("VNC was not instantiated.");
        this.vnc.pointerEvent(x, y, mask);
    }
    public acceptingInput(): boolean {
        return this.vncOpen;
    }
    public keyEvent(keysym: number, down: boolean): void {
        if (!this.vnc) throw new Error("VNC was not instantiated.");
        this.vnc.keyEvent(keysym, down ? 1 : 0);
    }
}
