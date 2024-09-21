import { VncClient } from '@cvmts/cvm-rs';
import { EventEmitter } from 'node:events';
import { Clamp } from '../Utilities.js';
import { VMDisplay, VMDisplayRect } from './interface.js';

import { Size, Rect } from '../Utilities.js';

// the FPS to run the VNC client at
// This only affects internal polling,
// if the VNC itself is sending updates at a slower rate
// the display will be at that slower rate
const kVncBaseFramerate = 60;

export type VncRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

enum State {
	Inactive,
	Connecting,
	Connected
}

export class VncDisplay extends EventEmitter implements VMDisplay {
	private displayVnc = new VncClient();

	private vncShouldReconnect: boolean = false;
	private vncConnectOpts: any;
	private connected = State.Inactive;

	constructor(vncConnectOpts: any) {
		super();

		this.vncConnectOpts = vncConnectOpts;

		let self = this;

		this.displayVnc.on('connect', () => {
			self.connected = State.Connected;
			self.emit('connected');
		});

		this.displayVnc.on('disconnect', () => {
			self.connected = State.Inactive;
			// instead of spamming we can nicely do it
			setTimeout(() => {
				self.Reconnect();
			}, 500);
		});

		this.displayVnc.on('resize', (size: Size) => {
			self.emit('resize', size);
		});

		this.displayVnc.on('rects', (rects: VMDisplayRect[]) => {
			self.emit('rects', rects);
			self.emit('frame');
		});

		
	}

	private Reconnect() {
		if (this.connected != State.Inactive && !this.vncShouldReconnect) return;

		// TODO: this should also give up after a max tries count
		// if we fail after max tries, emit a event

		if (this.vncConnectOpts.host) this.displayVnc.Connect(`${this.vncConnectOpts.host}:${this.vncConnectOpts.port}`);
		else if (this.vncConnectOpts.path) this.displayVnc.Connect(`${this.vncConnectOpts.path}`);
	}

	Connect() {
		this.vncShouldReconnect = true;
		this.Reconnect();
	}

	Disconnect() {
		this.vncShouldReconnect = false;
		this.displayVnc.Disconnect();
	}

	Connected() {
		return this.connected == State.Connected;
	}

	async GetThumbnail(): Promise<Buffer> {
		return this.displayVnc.Thumbnail();
	}

	async GetFullScreen(): Promise<Buffer> {
		return this.displayVnc.FullScreen();	
	}

	Size(): Size {
		if (!this.connected)
			return {
				width: 0,
				height: 0
			};

		return this.displayVnc.Size();
	}

	SetJpegQuality(quality: number) {
		if(this.connected) {
			return this.displayVnc.SetJpegQuality(quality);
		}
	}

	MouseEvent(x: number, y: number, buttons: number) {
		if (this.Connected()) {
			let size = this.displayVnc.Size() as Size;
			this.displayVnc.SendMouse(Clamp(x, 0, size.width), Clamp(y, 0, size.height), buttons);
		}
	}

	KeyboardEvent(keysym: number, pressed: boolean) {
		if (this.Connected()) this.displayVnc.SendKey(keysym, pressed);
	}
}
