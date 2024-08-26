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

export class VncClient extends EventEmitter {
	#client = new native.ClientInnerImpl();
	#size = null;
	#disc = false;

	async ConnectAsync(addr) {
		console.log('connect ', addr);
		this.#client.connect(addr);

		while (true) {
			let ev = this.#client.pollEvent();

			if (ev.event == 'connect') {
				this.emit('connect');
				this.#Spawn();
				return true;
			} else if (ev.event == 'disconnect') return false;

			if (ev.event == 'resize') {
				this.#size = ev.size;
				this.emit('resize', this.#size);
			}

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
						this.#size = ev.size;
						this.emit('resize', this.#size);
					}

					if (event.event == 'rects') {
						this.emit('rects', event.rects);
					}
				}

				await sleep(16);
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

