import { VMDisplay } from './interface';
import { EventEmitter } from 'node:events';

import { VncClient } from '@computernewb/nodejs-rfb';
import { Clamp } from '../Utilities.js';
import { BatchRects } from './batch.js';

import { Size, Rect } from '../Utilities.js';
import { HazelnutClient, HazelnutOptions } from './hazelnut_client.js';

const kVncBaseFramerate = 60;


enum HazelnutMode {
	// Display is via VNC.
	Vnc,
	// Display is via Hazelnut (fbc agent)
	Hazelnut
}



let bHazelnutControlledInput = false;

export class HazelnutDisplay extends EventEmitter implements VMDisplay {
	private mode = HazelnutMode.Vnc;

	private displayVnc = new VncClient({
		debug: false,
		fps: kVncBaseFramerate,

		encodings: [
			VncClient.consts.encodings.raw,

			//VncClient.consts.encodings.pseudoQemuAudio,
			VncClient.consts.encodings.pseudoDesktopSize
			// For now?
			//VncClient.consts.encodings.pseudoCursor
		]
	});

	private vncShouldReconnect: boolean = false;

	private vncConnectOpts: any;
	private hazelnut;

	constructor(vncConnectOpts: any, hazelnutOpts: HazelnutOptions) {
		super();
		this.vncConnectOpts = vncConnectOpts;
		this.hazelnut = new HazelnutClient(hazelnutOpts);

		let self = this;

		this.hazelnut.on('upgrade', () => {
			self.SetupHazlenut();
		});

		this.hazelnut.on('downgrade', () => {
			console.log('hazelnut downgrade');
			self.SetupVnc();
		});

		this.hazelnut.on('rect', (rect: Rect) => {
			self.emit('rect', rect);
			//self.emit('frame');
		});

		this.hazelnut.on('frame', () => {
			self.emit('frame');
		});

		this.hazelnut.on('resize', (size: Size) => {
			self.emit('resize', size);
		});
	}

	public SetupHazlenut() {
		this.displayVnc.removeAllListeners();
		this.mode = HazelnutMode.Hazelnut;
	}

	private SetupVnc() {
		this.mode = HazelnutMode.Vnc;

		this.displayVnc.on('connectTimeout', () => {
			this.Reconnect();
		});

		this.displayVnc.on('authError', () => {
			this.Reconnect();
		});

		this.displayVnc.on('disconnect', () => {
			this.Reconnect();
		});

		this.displayVnc.on('closed', () => {
			this.Reconnect();
		});

		this.displayVnc.on('firstFrameUpdate', () => {
			// Reset mode
			this.mode = HazelnutMode.Vnc;

			// apparently this library is this good.
			// at least it's better than the two others which exist.
			this.displayVnc.changeFps(kVncBaseFramerate);
			this.emit('connected');
			this.emit('resize', { width: this.displayVnc.clientWidth, height: this.displayVnc.clientHeight });
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

		this.Reconnect();
	}

	private reconnectBackoff() {
		let self = this;
		let to = setTimeout(() => {
			self.displayVnc.connect(self.vncConnectOpts);
			clearTimeout(to);
		}, 100);
	}

	private Reconnect() {
		if (this.displayVnc.connected) return;

		if (!this.vncShouldReconnect) return;

		// TODO: this should also give up after a max tries count
		// if we fail after max tries, emit a event

		this.reconnectBackoff();
	}

	Connect() {
		this.vncShouldReconnect = true;
		this.SetupVnc();
		this.Reconnect();

		// Start up Hazelnut if it has not started up before.
		if(!this.hazelnut.started())
			this.hazelnut.startup();
	}

	Disconnect() {
		this.vncShouldReconnect = false;
		this.displayVnc.disconnect();

		this.hazelnut.shutdown();

		// bye bye!
		//this.displayVnc.removeAllListeners();

		// Reset mode to VNC
		this.mode = HazelnutMode.Vnc;
	}

	Connected() {
		return this.displayVnc.connected;
	}

	Buffer(): Buffer {
		if (this.mode == HazelnutMode.Hazelnut) {
			return this.hazelnut.frameBuffer!;
		}

		return this.displayVnc.fb;
	}

	Size(): Size {
		if (!this.displayVnc.connected)
			return {
				width: 0,
				height: 0
			};

		if (this.mode == HazelnutMode.Hazelnut) {
			return {
				width: this.hazelnut.width,
				height: this.hazelnut.height
			};
		}

		return {
			width: this.displayVnc.clientWidth,
			height: this.displayVnc.clientHeight
		};
	}

	MouseEvent(x: number, y: number, buttons: number) {
		if (bHazelnutControlledInput) {
			if (this.mode == HazelnutMode.Hazelnut) {
				return this.hazelnut.sendMouse(Clamp(x, 0, this.hazelnut.width), Clamp(y, 0, this.hazelnut.height), buttons);
			}
		}
		if (this.displayVnc.connected) this.displayVnc.sendPointerEvent(Clamp(x, 0, this.displayVnc.clientWidth), Clamp(y, 0, this.displayVnc.clientHeight), buttons);
	}

	KeyboardEvent(keysym: number, pressed: boolean) {
		if (bHazelnutControlledInput) {
			if (this.mode == HazelnutMode.Hazelnut) {
				return this.hazelnut.sendKey(keysym, pressed);
			}
		}
		if (this.displayVnc.connected) this.displayVnc.sendKeyEvent(keysym, pressed);
	}
}
