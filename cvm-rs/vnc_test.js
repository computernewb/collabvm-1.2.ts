// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let native = require('./index.node');

// test the new rust vnc engine that have 
// Unlock Performace Now and cmake installed

let client = new native.ClientInnerImpl();

let done = false;

(async () => {
	(async () => {
		//127.0.0.1:6930
		await client.connectAndRunEngine("10.16.0.1:5930");
		console.log("piss")
		done = true;
	})();

	let a;
	
	a = setInterval(async () => {
		let rand = () => Math.floor( Math.random() * 0x102249);
		if(done) {
			clearInterval(a);
			return;
		}

		await client.sendMouse(rand() % 320, rand() % 240, 0);
	}, 10);

	// after some time disconnect
	setTimeout(() => {
		console.log("bye bye");
		client.disconnect();

		client = null;

		setTimeout(() => {
			console.log("done");
		}, 10000)
	}, 2000);

})();


