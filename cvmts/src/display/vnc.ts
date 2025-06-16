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

let safeDefer = (fn: () => void, timeout: number) => {
	let iv = setTimeout(() => {
		fn();
		clearTimeout(iv);
	}, timeout);
};

// The max amount of tries before the client will give up.
const kVncMaxTries = 5;

// TODO: replace with a non-asshole VNC client (prefably one implemented
// as a part of cvm-rs)
export class VncDisplay extends EventEmitter implements VMDisplay {
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
	private nrReconnectBackoffSteps = 0;

	private doBackoff;

	constructor(vncConnectOpts: any, wantsBackoff = true) {
		super();
		this.doBackoff = wantsBackoff;

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
			// we connected and got the first frame, so we can reset backoff.
			this.nrReconnectBackoffSteps = 0;

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
	}

	private getReconnectBackoffMs() {
		const kReconnectTimeBase = 250;
		if (this.nrReconnectBackoffSteps == 0) return 0;

		return Math.exp(this.nrReconnectBackoffSteps) * kReconnectTimeBase;
	}

	private Reconnect() {
		if (this.displayVnc.connected) return;
		if (!this.vncShouldReconnect) return;
		

		if (this.doBackoff) {
			this.emit('disconnect');

			//console.log('reconnecting in %d seconds (%d steps)', this.getReconnectBackoffMs() / 1000, this.nrReconnectBackoffSteps);
			if (this.nrReconnectBackoffSteps + 1 > kVncMaxTries) {
				// Failed to connnect
				this.emit('fail');
				return;
			}

			safeDefer(() => {
				this.displayVnc.connect(this.vncConnectOpts);
			}, this.getReconnectBackoffMs());

			this.nrReconnectBackoffSteps++;
		} else {
			safeDefer(() => {
				this.displayVnc.connect(this.vncConnectOpts);
			}, 0);
		}
	}

	Connect() {
		this.vncShouldReconnect = true;
		this.Reconnect();
	}

	Disconnect() {
		this.vncShouldReconnect = false;
		this.displayVnc.disconnect();
		this.emit('finalDisconnect');
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
