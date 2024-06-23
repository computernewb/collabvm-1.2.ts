import { WebSocket } from 'ws';
import NetworkClient from '../NetworkClient.js';
import EventEmitter from 'events';
import { Logger } from '@cvmts/shared';

export default class WSClient extends EventEmitter implements NetworkClient {
	socket: WebSocket;
	ip: string;

	constructor(ws: WebSocket, ip: string) {
		super();
		this.socket = ws;
		this.ip = ip;
		this.socket.on('message', (buf: Buffer, isBinary: boolean) => {
			// Close the user's connection if they send a non-string message
			if (isBinary) {
				this.close();
				return;
			}

			this.emit('msg', buf.toString('utf-8'));
		});

		this.socket.on('close', () => {
			this.emit('disconnect');
		});
	}

	isOpen(): boolean {
		return this.socket.readyState === WebSocket.OPEN;
	}

	getIP(): string {
		return this.ip;
	}
	send(msg: string): Promise<void> {
		return new Promise((res, rej) => {
			if (!this.isOpen()) res();

			this.socket.send(msg, (err) => {
				if (err) {
					rej(err);
					return;
				}
				res();
			});
		});
	}

	close(): void {
		if (this.isOpen()) {
			// While this seems counterintutive, do note that the WebSocket protocol
			// *sends* a data frame whilist closing a connection. Therefore, if the other end
			// has forcibly hung up (closed) their connection, the best way to handle that
			// is to just let the inner TCP socket propegate that, which `ws` will do for us.
			// Otherwise, we'll try to send data to a closed client then SIGPIPE.
			this.socket.close();
		}
	}
}
