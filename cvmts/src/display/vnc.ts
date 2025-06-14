import { VncClient } from '@computernewb/nodejs-rfb';
import { EventEmitter } from 'node:events';
import { Clamp } from '../Utilities.js';
import { BatchRects } from './batch.js';
import { VMDisplay } from './interface.js';

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


// TODO: replace with a non-asshole VNC client (prefably one implemented
// as a part of cvm-rs)
export class VncDisplay extends EventEmitter implements VMDisplay {
	private displayVnc = new VncClient({
		debug: false,
		fps: kVncBaseFramerate,

		encodings: [
			VncClient.consts.encodings.raw,

			VncClient.consts.encodings.pseudoQemuAudio,
			VncClient.consts.encodings.pseudoDesktopSize
			// For now?
			//VncClient.consts.encodings.pseudoCursor
		]
	});

	private vncShouldReconnect: boolean = false;
	private vncConnectOpts: any;

	constructor(vncConnectOpts: any) {
		super();

		this.vncConnectOpts = vncConnectOpts;

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

		this.displayVnc.on('audioStream', (pcm: Buffer) => {
			this.emit('audioStream', pcm);
		});
	}

	private Reconnect() {
		if (this.displayVnc.connected) return;

		if (!this.vncShouldReconnect) return;

		// TODO: this should also give up after a max tries count
		// if we fail after max tries, emit a event

		this.displayVnc.connect(this.vncConnectOpts);
	}

	Connect() {
		this.vncShouldReconnect = true;
		this.Reconnect();
	}

	Disconnect() {
		this.vncShouldReconnect = false;
		this.displayVnc.disconnect();

		// bye bye!
		this.displayVnc.removeAllListeners();
		this.removeAllListeners();
	}

	Connected() {
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

	MouseEvent(x: number, y: number, buttons: number) {
		if (this.displayVnc.connected) this.displayVnc.sendPointerEvent(Clamp(x, 0, this.displayVnc.clientWidth), Clamp(y, 0, this.displayVnc.clientHeight), buttons);
	}

	KeyboardEvent(keysym: number, pressed: boolean) {
		if (this.displayVnc.connected) this.displayVnc.sendKeyEvent(keysym, pressed);
	}
}
