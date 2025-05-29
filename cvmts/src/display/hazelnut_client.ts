import pino from 'pino';
import { createServer as netCreateServer, Socket as netSocket } from 'node:net';
import { Stopwatch } from '../util/stopwatch.js';
import { EventEmitter } from 'node:events';

import { Size, Rect } from '../Utilities.js';

import { BatchRects } from './batch.js';

let sleep = (ms: number) => new Promise<void>((res, rej) => setTimeout(() => res(), ms));

async function semiBlockingRead(socket: netSocket, len: number): Promise<Buffer> {
	let buf;
	while (true) {
		if (!socket.readable) throw new Error('cannot read from closed socket');
		buf = socket.read(len) as Buffer | null;
		if (buf) {
			break;
		}

		await sleep(0);
	}

	return buf!;
}

const kHazelnutMessageHeaderSize = 8;

const kHazelnutChannelPortBase = 9438;

enum HazelnutMessageType {
	Resize = 0, // tResizeMessage
	Frame = 1, // tFrameMessage

	Ping = 2, // no data
	Pong = 3, // no data

	KeyInput = 4,
	MouseInput = 5
}


export interface HazelnutOptions {
	/// The listen address the Hazelnut display should use.
	listen_address: string,

	/// The channel the VM will use
	channel: number
}

//
export class HazelnutClient extends EventEmitter {
	private logger = pino({ name: 'Hazelnut:Client' });
	private server;
	private client: netSocket | null = null;

	// framebuffer.
	public width = 0;
	public height = 0;
	public frameBuffer: Buffer | null = null;

	private opts;

	constructor(hazelnutOpts: HazelnutOptions) {
		super();

		if(hazelnutOpts.channel > 0) {
			throw new Error('The provided channel must not be less than 0 or a negative number.');
		}

		this.opts = hazelnutOpts;

		let self = this;
		this.server = netCreateServer((socket) => {
			if (this.client) {
				this.logger.warn('Got client whilist already supposedly connected to one. Replacing.');
				this.client.end();
				this.client = null;
			}

			self.logger.info('Got new Hazelnut display client');

			// dont use data event
			// (todo: actually probably should)
			socket.pause();

			// Configure the socket so it's hot
			socket.setNoDelay(true);
			socket.setKeepAlive(false);

			this.client = socket;
			this.onClient();
		});
	}

	started() {
		return this.server.listening;
	}

	startup() {
		this.server.listen(kHazelnutChannelPortBase + this.opts.channel, this.opts.listen_address);
	}


	downgrade() {
		this.emit('downgrade');
		this.client = null;
		// reset the framebuffer
		this.width = 0;
		this.height = 0;
		this.frameBuffer = null;
	}

	shutdown() {
		this.emit('downgrade');
		this.client = null;
		this.server.close();
	}

	onClient() {
		if (this.client) {
			// bogus for typscipt.
			this.clientMain(this.client);
		}
	}

	async clientMain(socket: netSocket) {
		this.emit('upgrade');
		let ping_stopwatch = new Stopwatch();
		let pong_stopwatch = new Stopwatch();

		ping_stopwatch.reset();

		try {
			socket.on('error', (e) => {
				this.downgrade();
			});

			while (true) {
				if (ping_stopwatch.elapsedMillis >= 1000) {
					//console.log("Time to send a ping");
					this.sendPing();
					ping_stopwatch.reset();
					pong_stopwatch.reset(); // Start the pong stopwatch
				}

				let header = await semiBlockingRead(socket, 8);

				let header_type = header.readUInt32LE(0) as HazelnutMessageType;
				let header_datalen = header.readUint32LE(4);

				if (header_type == HazelnutMessageType.Resize) {
					if (header_datalen != 8) {
						this.logger.error('invalid RESIZE message');
						break;
					}

					let resize_data = await semiBlockingRead(socket, 8);

					let resize_width = resize_data.readUint32LE(0);
					let resize_height = resize_data.readUint32LE(4);

					this.frameBuffer = Buffer.alloc(resize_width * resize_height * 4);
					this.width = resize_width;
					this.height = resize_height;

					this.emit('resize', {
						width: this.width,
						height: this.height
					});
				} else if (header_type == HazelnutMessageType.Frame) {
					if (header_datalen != 4) {
						this.logger.error('invalid FRAME message');
						break;
					}

					let data_header = await semiBlockingRead(socket, 4);

					let tile_count = data_header.readUint32LE(0);

					//console.log(`${tile_count} tiles`);

					let rects: Rect[] = [];

					for (let i = 0; i < tile_count; ++i) {
						let tile_rect = await semiBlockingRead(socket, 16);

						let tile_x = tile_rect.readUint32LE(0);
						let tile_y = tile_rect.readUint32LE(4);
						let tile_width = tile_rect.readUint32LE(8);
						let tile_height = tile_rect.readUint32LE(12);

						/*console.log('tile', i, {
								x: tile_x,
								y: tile_y,
								width: tile_width,
								height: tile_height
							});*/

						rects.push({
							x: tile_x,
							y: tile_y,
							width: tile_width,
							height: tile_height
						});
					}

					let buf = await semiBlockingRead(socket, this.width * this.height * 4);
					if (this.frameBuffer) {
						buf.copy(this.frameBuffer, 0, 0, buf.byteLength);
					}

					if (tile_count == 0) {
						continue;
					}

					//console.log('rects', rects)

					// rects baybeeee
					let batched = BatchRects({ width: this.width, height: this.height }, rects);

					//console.log("batched", batched);
					this.emit('rect', batched);

					this.emit('frame');

					await sleep(5); // sleep a bit :)
				} else if (header_type == HazelnutMessageType.Pong) {
					if (header_datalen != 0) {
						this.logger.error('invalid PONG message');
						break;
					}

					if (pong_stopwatch.elapsedMillis >= 1500) {
						this.logger.error('Agent failed to respond to ping request in a timely manner. Downgrading');
						break;
					}

					console.log('got pong in ~%dms after sending ping', pong_stopwatch.elapsedMillis);
				} else {
					this.logger.error('Invalid message type, downgrading');
					break;
				}
			}
		} catch (err) {
			this.logger.error({ error: err }, 'Hazelnut client error');
		}

		socket.end();
		this.downgrade();
	}

	sendMessage(type: HazelnutMessageType, datalen: number, structFill: ((b: Buffer) => void) | null) {
		let message = Buffer.allocUnsafe(kHazelnutMessageHeaderSize + datalen);
		message.writeUint32LE(type as number, 0);
		message.writeUint32LE(datalen, 4);

		if (datalen != 0) {
			if (structFill == null) throw new Error('When using HazelnutClient#sendMessage() with a datalen != 0, you must provide structFill.');
			structFill(message);
		}

		if (this.client) {
			this.client.write(message);
		}
	}

	sendPing() {
		this.sendMessage(2, 0, null);
	}

	sendKey(keysym: number, pressed: boolean) {
		console.log('TEST: Hazelnut backed key message', keysym, pressed);

		this.sendMessage(HazelnutMessageType.KeyInput, 5, (b) => {
			b.writeUint32LE(keysym, kHazelnutMessageHeaderSize + 0);
			b.writeUInt8(pressed == true ? 1 : 0, kHazelnutMessageHeaderSize + 4);
		});
	}

	sendMouse(x: number, y: number, buttonMask: number) {
		console.log('TEST: Hazelnut backed mouse message', x, y, buttonMask);
		this.sendMessage(HazelnutMessageType.MouseInput, 9, (b) => {
			b.writeUInt32LE(x, kHazelnutMessageHeaderSize + 0);
			b.writeUInt32LE(y, kHazelnutMessageHeaderSize + 4);
			b.writeUInt8(buttonMask & 0xff, kHazelnutMessageHeaderSize + 8);
		});
	}

}
