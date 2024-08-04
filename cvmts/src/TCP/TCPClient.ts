import EventEmitter from 'events';
import NetworkClient from '../NetworkClient.js';
import { Socket } from 'net';

const TextHeader = 0;
const BinaryHeader = 1;

export default class TCPClient extends EventEmitter implements NetworkClient {
	private socket: Socket;
	private cache: string;

	constructor(socket: Socket) {
		super();
		this.socket = socket;
		this.cache = '';
		this.socket.on('end', () => {
			this.emit('disconnect');
		});
		this.socket.on('data', (data) => {
			var msg = data.toString('utf-8');
			if (msg[msg.length - 1] === '\n') msg = msg.slice(0, -1);
			this.cache += msg;
			this.readCache();
		});
	}

	private readCache() {
		for (var index = this.cache.indexOf(';'); index !== -1; index = this.cache.indexOf(';')) {
			this.emit('msg', this.cache.slice(0, index + 1));
			this.cache = this.cache.slice(index + 1);
		}
	}

	getIP(): string {
		return this.socket.remoteAddress!;
	}

	send(msg: string): Promise<void> {
		return new Promise((res, rej) => {
			let _msg = new Uint32Array([TextHeader, ...Buffer.from(msg, 'utf-8')]);
			this.socket.write(Buffer.from(_msg), (err) => {
				if (err) {
					rej(err);
					return;
				}
				res();
			});
		});
	}

	sendBinary(msg: Uint8Array): Promise<void> {
		return new Promise((res, rej) => {
			let _msg = new Uint32Array([BinaryHeader, msg.length, ...msg]);
			this.socket.write(Buffer.from(_msg), (err) => {
				if (err) {
					rej(err);
					return;
				}
				res();
			});
		});
	}

	close(): void {
		this.emit('disconnect');
		this.socket.end();
	}

	isOpen(): boolean {
		return this.socket.writable;
	}
}
