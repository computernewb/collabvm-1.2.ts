// *sigh*

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import EventEmitter from 'events';

let native = require('./index.node');

// Wrapper over the cvm-rs native VNC client engine
// to make it more idiomatic node.js
export class VncClient extends EventEmitter {
	#client = new native.ClientInnerImpl();
	#size = null;
	#disc = false;

	Connect(addr) {
		this.#client.connect(addr);

		// Run a reduced speed poll in the background
		// to wait until we get a connect or disconnect event
		// from the Rust VNC engine
		let poll = () => {
			let ev = this.#client.pollEvent();

			if (ev.event == 'connect') {
				this.#Spawn();
				return;
			} else if (ev.event == 'disconnect') {
				this.#client.disconnect();
				this.emit('disconnect');
				return;
			}

			setTimeout(() => {
				process.nextTick(poll);
			}, 66);
		};

		process.nextTick(poll);
	}

	#Spawn() {
		let self = this;

		this.emit('connect');

		let loop = () => {
			if (self.#disc) {
				self.#disc = false;
				self.#client.disconnect();
				this.emit('disconnect');
				return;
			}

			let event = self.#client.pollEvent();

			// empty object means there was no event observed
			if (event.event !== undefined) {
				switch (event.event) {
					case 'disconnect':
						this.emit('disconnect');
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
				process.nextTick(loop);
			}, 8);
		};

		process.nextTick(loop);
	}

	async SendMouse(x, y, buttons) {
		await this.#client.sendMouse(x, y, buttons);
	}

	async SendKey(keysym, pressed) {
		await this.#client.sendKey(keysym, pressed);
	}

	async Thumbnail() {
		// send request
		await this.#client.thumbnail();

		// wait for it to come
		return new Promise((res, rej) => {
			this.once('thumbnail', (data) => {
				res(data);
			});
		});
	}

	async FullScreen() {
		await this.#client.fullScreen();
		return new Promise((res, rej) => {
			this.once('fullscreen', (data) => {
				res(data);
			});
		});
	}

	Size() {
		return this.#size;
	}

	Disconnect() {
		process.nextTick(() => {
			this.#disc = true;
		});
	}
}
