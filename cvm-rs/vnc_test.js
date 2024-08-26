// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// we don't need that much calm the fuck down
process.env.TOKIO_WORKER_THREADS = 4;

let native = require('./index.node');

// test the new rust vnc engine that have
// Unlock Performace Now and cmake installed

let client = new native.ClientInnerImpl();

let done = false;
function sleep(ms) {
	return {
		then: (cb) => {
			setTimeout(() => cb(), ms);
		}
	};
}

// makes connection async by polling at a slower rate
// this is techinically probably bad or something but /shrug
async function clientConnectAsync(client, addr) {
	client.connect(addr);

	while (true) {
		let ev = client.pollEvent();
		if (ev.event == 'connect') return true;
		else if (ev.event == 'disconnect') return false;

		await sleep(66);
	}
}

(async () => {
	(async () => {
		/*
		//127.0.0.1:6930
		client.connectAndRunEngine("10.16.0.1:5930");
		*/

		if (!(await clientConnectAsync(client, '10.16.0.1:5930'))) {
			done = true;
			return;
		}

		// engine loop on JS side
		while (!done) {
			let event = client.pollEvent();

			if (event.event !== undefined) {
				console.log(event);
				if (event.event == 'disconnect') {
					done = true;
					break;
				}
			}

			await sleep(16);
		}

		console.log('piss');
	})();

	if (0) {
		let a;

		a = setInterval(async () => {
			let rand = () => Math.floor(Math.random() * 0x102249);
			if (done) {
				clearInterval(a);
				return;
			}

			await client.sendMouse(rand() % 320, rand() % 240, 0);
		}, 10);
	}

	if (1) {
		// after some time disconnect
		setTimeout(() => {
			console.log('bye bye');
			client.disconnect();

			

			setTimeout(() => {
				console.log('done');
			}, 10000);
		}, 2000);
	}
})();
