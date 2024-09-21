import { cvmrsRequire } from './require.js';
import EventEmitter from 'node:events';

const native = cvmrsRequire('./index.node');

const kIdlePollRate = 66;
const kFastPollRate = 8;

// Wrapper over the cvm-rs VNC client engine
// to make it more idiomatic node.js.
export class VncClient extends EventEmitter {
	#client = null;
	#size = null;
	#disconnectFlag = false;

	constructor() {
		super();

		let self = this;
		this.on('disconnect', () => {
			this.#client = null;
		});
	}

	Connect(addr) {
		// Create a VNC client object if one does not exist
		if (this.#client == null) this.#client = native.vncNew();

		native.vncConnect(this.#client, addr);

		// Run a reduced speed poll (since it doesn't need to be
		// fast or really that high priority).
		// This poll is done until we get a connect or disconnect event
		// from the Rust VNC engine. Once we either one, we handle it as needed.
		let slowPollUntilConnect = () => {
			if (this.#client == null) return;

			let ev = native.vncPollEvent(this.#client);

			if (ev.event == 'connect') {
				this.#StartFastPoll();
				return;
			} else if (ev.event == 'disconnect') {
				native.vncDisconnect(this.#client);
				this.emit('disconnect');
				return;
			}

			setTimeout(() => {
				process.nextTick(slowPollUntilConnect);
			}, kIdlePollRate);
		};

		process.nextTick(slowPollUntilConnect);
	}

	#StartFastPoll() {
		let self = this;

		this.emit('connect');

		let fastPollForEvent = () => {
			if (self.#client == null) return;

			if (self.#disconnectFlag) {
				self.#disconnectFlag = false;
				native.vncDisconnect(self.#client);
				self.emit('disconnect');
				return;
			}

			let event = native.vncPollEvent(self.#client);

			// An empty object means there was no event observed
			if (event.event !== undefined) {
				switch (event.event) {
					case 'disconnect':
						self.emit('disconnect');
						return;

					case 'resize':
						self.#size = event.size;
						self.emit('resize', self.#size);
						break;

					case 'rects':
						self.emit('rects', event.rects);
						break;

					case 'thumbnail':
						self.emit('thumbnail', event.data);
						break;

					case 'screen':
						self.emit('fullscreen', event.data);
						break;

					default:
						break;
				}
			}

			setTimeout(() => {
				process.nextTick(fastPollForEvent);
			}, kFastPollRate);
		};

		process.nextTick(fastPollForEvent);
	}

	async SendMouse(x, y, buttons) {
		native.vncSendMouse(this.#client, x, y, buttons);
	}

	async SendKey(keysym, pressed) {
		native.vncSendKey(this.#client, keysym, pressed);
	}

	async Thumbnail() {
		// send request
		native.vncThumbnail(this.#client);

		// wait for the response to come
		return new Promise((res, rej) => {
			this.once('thumbnail', (data) => {
				res(data);
			});
		});
	}

	async FullScreen() {
		native.vncFullScreen(this.#client);
		return new Promise((res, rej) => {
			this.once('fullscreen', (data) => {
				res(data);
			});
		});
	}

	SetJpegQuality(quality) {
		native.vncSetJPEGQuality(this.#client, quality);
	}

	Size() {
		return this.#size;
	}

	Disconnect() {
		process.nextTick(() => {
			this.#disconnectFlag = true;
		});
	}
}
