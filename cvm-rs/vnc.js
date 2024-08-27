// *sigh*

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import EventEmitter from 'events';

let native = require('./index.node');

// Wrapper over the cvm-rs native VNC client inner
// to make it more idiomatic node.js
export class VncClient extends EventEmitter {
	#client = new native.ClientInnerImpl();
	#size = null;
	#disc = false;
	#buffer = null;

	Connect(addr) {
		this.#client.connect(addr);

		// run a reduced speed poll to wait until we get a connect or disconnect event
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

				console.log('disconnecting in loop');
				self.#client.disconnect();
				this.emit('disconnect');
				return;
			}

			let event = self.#client.pollEvent();

			// empty object means there was no event observed
			if (event.event !== undefined) {
				if (event.event == 'disconnect') {
					this.emit('disconnect');
					return;
				}

				if (event.event == 'resize') {
					self.#buffer = self.#client.getSurfaceBuffer();
					self.#size = event.size;
					self.emit('resize', self.#size);
				}

				if (event.event == 'rects') {
					self.emit('rects', event.rects);
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

	Size() {
		return this.#size;
	}

	Buffer() {
		return this.#buffer;
	}

	Disconnect() {
		process.nextTick(() => {
			this.#disc = true;
		});
	}
}
