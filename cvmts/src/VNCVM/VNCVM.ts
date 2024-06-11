import EventEmitter from "events";
import VNCVMDef from "./VNCVMDef";
import VM from "../VM";
import VMDisplay from "../VMDisplay";
import { Clamp, Logger, Rect, Size, Sleep } from "@cvmts/shared";
import { VncClient } from '@computernewb/nodejs-rfb';
import { BatchRects } from "@cvmts/qemu";
import { execaCommand } from "execa";

export default class VNCVM extends EventEmitter implements VM, VMDisplay {
    def : VNCVMDef;
    logger: Logger;
    private displayVnc = new VncClient({
        debug: false,
        fps: 60,
        encodings: [
            VncClient.consts.encodings.raw,
            VncClient.consts.encodings.pseudoDesktopSize
        ]
    });
    private vncShouldReconnect: boolean = false;

    constructor(def : VNCVMDef) {
        super();
        this.def = def;
        this.logger = new Logger(`CVMTS.VNCVM/${this.def.vncHost}:${this.def.vncPort}`);

        this.displayVnc.on('connectTimeout', () => {
			this.Reconnect();
		});

		this.displayVnc.on('authError', () => {
			this.Reconnect();
		});

		this.displayVnc.on('disconnect', () => {
            this.logger.Info('Disconnected');
			this.Reconnect();
		});

		this.displayVnc.on('closed', () => {
			this.Reconnect();
		});

		this.displayVnc.on('firstFrameUpdate', () => {
            this.logger.Info('Connected');
			// apparently this library is this good.
			// at least it's better than the two others which exist.
			this.displayVnc.changeFps(60);
			this.emit('connected');

			this.emit('resize', { width: this.displayVnc.clientWidth, height: this.displayVnc.clientHeight });
			//this.emit('rect', { x: 0, y: 0, width: this.displayVnc.clientWidth, height: this.displayVnc.clientHeight });
			this.emit('frame');
		});

		this.displayVnc.on('desktopSizeChanged', (size: Size) => {
			this.emit('resize', size);
		});

		let rects: Rect[] = [];

		this.displayVnc.on('rectUpdateProcessed', (rect: Rect) => {
			rects.push(rect);
		});

		this.displayVnc.on('frameUpdated', (fb: Buffer) => {
			// use the cvmts batcher
			let batched = BatchRects(this.Size(), rects);
			this.emit('rect', batched);

			// unbatched (watch the performace go now)
			//for(let rect of rects)
			//	this.emit('rect', rect);

			rects = [];

			this.emit('frame');
		});
    }


    async Reset(): Promise<void> {
        if (this.def.restoreCmd) await execaCommand(this.def.restoreCmd, {shell: true});
        else {
            await this.Stop();
            await Sleep(1000);
            await this.Start();
        }
    }

	private Reconnect() {
		if (this.displayVnc.connected) return;

		if (!this.vncShouldReconnect) return;

		// TODO: this should also give up after a max tries count
		// if we fail after max tries, emit a event

		this.displayVnc.connect({
            host: this.def.vncHost,
            port: this.def.vncPort,
            path: null,
		});
	}

    async Start(): Promise<void> {
        this.logger.Info('Connecting');
        if (this.def.startCmd) await execaCommand(this.def.startCmd, {shell: true});
        this.Connect();
    }

    async Stop(): Promise<void> {
        this.logger.Info('Disconnecting');
        this.Disconnect();
        if (this.def.stopCmd) await execaCommand(this.def.stopCmd, {shell: true});
    }

    async Reboot(): Promise<void> {
        if (this.def.rebootCmd) await execaCommand(this.def.rebootCmd, {shell: true});
    }

    async MonitorCommand(command: string): Promise<any> {
        // TODO: This can maybe run a specified command?
        return "This VM does not support monitor commands.";
    }

    GetDisplay(): VMDisplay {
        return this;
    }

    SnapshotsSupported(): boolean {
        return true;
    }

    Connect(): void {
        this.vncShouldReconnect = true;
        this.Reconnect();
    }

    Disconnect(): void {
        this.vncShouldReconnect = false;
        this.displayVnc.disconnect();
    }

    Connected(): boolean {
        return this.displayVnc.connected;
    }

    Buffer(): Buffer {
        return this.displayVnc.fb;
    }

    Size(): Size {
		if (!this.displayVnc.connected)
			return {
				width: 0,
				height: 0
			};

		return {
			width: this.displayVnc.clientWidth,
			height: this.displayVnc.clientHeight
		};
    }

    MouseEvent(x: number, y: number, buttons: number): void {
		if (this.displayVnc.connected) this.displayVnc.sendPointerEvent(Clamp(x, 0, this.displayVnc.clientWidth), Clamp(y, 0, this.displayVnc.clientHeight), buttons);
    }

    KeyboardEvent(keysym: number, pressed: boolean): void {
		if (this.displayVnc.connected) this.displayVnc.sendKeyEvent(keysym, pressed);
    }
}