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
		console.log('VncClient.connectAsync()', addr);
		this.#client.connect(addr);

		// run a reduced speed poll until we get a connect or disconnect event
		while (true) {
			let ev = this.#client.pollEvent();

			if (ev.event == 'connect') {
				this.emit('connect');
				this.#Spawn();
				return true;
			} else if (ev.event == 'disconnect') return false;

			await sleep(66);
		}
	}

	async #Spawn() {
		(async () => {
			// engine loop on JS side
			while (!this.#disc) {
				let event = this.#client.pollEvent();

				// empty object means there was no event observed
				if (event.event !== undefined) {
					//console.log(event);
					if (event.event == 'disconnect') {
						break;
					}

					if (event.event == 'resize') {
						console.log('resize event');
						this.#size = event.size;
						this.emit('resize', this.#size);
					}

					if (event.event == 'rects') {
						this.emit('rects', event.rects);
					}
				}

				await sleep(8);
			}

			this.#disc = false;
		}).call(this);
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
		this.#disc = true;
		this.#client.disconnect();
		this.emit('disconnect');
	}
}
