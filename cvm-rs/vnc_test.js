import { VncClient } from './vnc.js';
import * as fs from 'node:fs/promises';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let native = require('./index.node');

// we don't need that much calm the fuck down
process.env.TOKIO_WORKER_THREADS = 4;

let client = new VncClient();

function sleep(ms) {
	return {
		then: (cb) => {
			setTimeout(() => cb(), ms);
		}
	};
}

(async () => {
	console.log('piss');
	let once = false;

	client.on('connect', async () => {
	})

	client.on('rects', async (rects) => {
		console.log('Rects:', rects);
		//console.log('got rects?');
	});

	client.on('resize', async (size) => {
		console.log('New size:', size);

		let data = await client.FullScreen();

		console.log('full screen size', data.constructor);
	});

	// 127.0.0.1:6930
	//10.16.0.1:5930
	client.Connect('127.0.0.1:6930');
		

	if (0) {
		// .kit on
		while (true) {
			let rand = () => Math.floor(Math.random() * 0x102249);
			await client.SendMouse(rand() % client.Size().width, rand() % client.Size().height, (rand() >>> 0) & 0x04);
			await sleep(10);
		}
	}
})();
