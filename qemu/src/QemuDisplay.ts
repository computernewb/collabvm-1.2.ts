import { VncClient } from '@computernewb/nodejs-rfb';
import { EventEmitter } from 'node:events';
import { BatchRects } from './QemuUtil.js';
import { Size, Rect, Clamp } from '@cvmts/shared';

const kQemuFps = 60;

export type VncRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

// events:
//
// 'resize' -> (w, h) -> done when resize occurs
// 'rect' -> (x, y, ImageData) -> framebuffer
// 'frame' -> () -> done at end of frame

export class QemuDisplay extends EventEmitter {
	private displayVnc = new VncClient({
		debug: false,
		fps: kQemuFps,

		encodings: [
			VncClient.consts.encodings.raw,

			//VncClient.consts.encodings.pseudoQemuAudio,
			VncClient.consts.encodings.pseudoDesktopSize
			// For now?
			//VncClient.consts.encodings.pseudoCursor
		]
	});

	private vncShouldReconnect: boolean = false;
	private vncSocketPath: string;

	constructor(socketPath: string) {
		super();

		this.vncSocketPath = socketPath;

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
			this.displayVnc.changeFps(kQemuFps);
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

	private Reconnect() {
		if (this.displayVnc.connected) return;

		if (!this.vncShouldReconnect) return;

		// TODO: this should also give up after a max tries count
		// if we fail after max tries, emit a event

		this.displayVnc.connect({
			path: this.vncSocketPath
		});
	}

	Connect() {
		this.vncShouldReconnect = true;
		this.Reconnect();
	}

	Disconnect() {
		this.vncShouldReconnect = false;
		this.displayVnc.disconnect();
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
