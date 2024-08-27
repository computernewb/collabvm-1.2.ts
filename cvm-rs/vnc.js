// *sigh*

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import EventEmitter from 'events';

let native = require('./index.node');

function sleep(ms) {
	return {
		then: (cb) => {
			setTimeout(() => cb(), ms);
		}
	};
}

// Wrapper over the cvm-rs native VNC client inner
// to make it more node-matic
export class VncClient extends EventEmitter {
	#client = new native.ClientInnerImpl();
	#size = null;
	#disc = false;

	async ConnectAsync(addr) {
		this.#client.connect(addr);

		// run a reduced speed poll until we get a connect or disconnect event
		while (true) {
			let ev = this.#client.pollEvent();

			if (ev.event == 'connect') {
				this.#Spawn();
				return true;
			} else if (ev.event == 'disconnect') return false;

			await sleep(66);
		}
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
					console.log('recv disconnect event');
					this.emit('disconnect');
					return;
				}

				if (event.event == 'resize') {
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
		return this.#client.getSurfaceBuffer();
	}

	Disconnect() {
		process.nextTick(() => {
			console.log('disconnecting');
			this.#disc = true;
		});
	}
}
