// *sigh*

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import EventEmitter from 'events';

import * as fs from 'node:fs/promises';

// we don't need that much calm the fuck down
process.env.TOKIO_WORKER_THREADS = 4;

let native = require('./index.node');

// test the new rust vnc engine that have
// Unlock Performace Now and cmake installed

function sleep(ms) {
	return {
		then: (cb) => {
			setTimeout(() => cb(), ms);
		}
	};
}

class VncClient extends EventEmitter {
	#client = new native.ClientInnerImpl();
	#size = null;
	#disc = false;

	async ConnectAsync(addr) {
		this.#client.connect(addr);

		while (true) {
			let ev = this.#client.pollEvent();
			if (ev.event == 'connect') {
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

	Size() {
		return this.#size;
	}

	Buffer() {
		return this.#client.getSurfaceBuffer();
	}

	Disconnect() {
		this.#disc = true;
		client.disconnect();
		this.emit('disconnect');
	}
}

let client = new VncClient();

(async () => {
	console.log('piss');
	let once = false;

	client.on('rects', async (rects) => {
		//console.log('Rects:', rects);

		if(once == false) {
			let b = client.Buffer();

			let buf = await native.jpegEncode({
				width: client.Size().width,
				height: client.Size().height,
				stride: client.Size().width,
				buffer: b
			});

			await fs.writeFile("./pissing.jpg", buf);
		}
	});

	client.on('resize', (size) => {
		console.log('New size:', size);
	});

	// 127.0.0.1:6930
	//10.16.0.1:5930
	if (!(await client.ConnectAsync('127.0.0.1:6930'))) {
		return;
	}

	// .kit on
	while (true) {
		let rand = () => Math.floor(Math.random() * 0x102249);
		await client.SendMouse(rand() % client.Size().width, rand() % client.Size().height, (rand() >>> 0) & 0x04);
		await sleep(100);
	}
})();
