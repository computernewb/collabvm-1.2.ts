import { WebSocket } from 'ws';
import { NetworkClient } from '../NetworkClient.js';
import EventEmitter from 'events';
import pino from 'pino';

export default class WSClient extends EventEmitter implements NetworkClient {
	socket: WebSocket;
	ip: string;
	enforceTextOnly = true
	private logger = pino({ name: "CVMTS.WebsocketClient" });

	constructor(ws: WebSocket, ip: string) {
		super();
		this.socket = ws;
		this.ip = ip;
		this.socket.on('message', (buf: Buffer, isBinary: boolean) => {
			// Close the user's connection if they send a binary message
			// when we are not expecting them yet.
			if (isBinary && this.enforceTextOnly) {
				this.close();
				return;
			}

			this.emit('msg', buf, isBinary);
		});

		this.socket.on('error', (err: Error) => {
			this.logger.error(err, 'WebSocket recv error');
		})

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
			if (!this.isOpen()) return res();

			this.socket.send(msg, (err) => {
				if (err) {
					this.logger.error(err, 'WebSocket send error');
					this.close();
					res();
					return;
				}
				res();
			});
		});
	}

	sendBinary(msg: Uint8Array): Promise<void> {
		return new Promise((res, rej) => {
			if (!this.isOpen()) return res();

			this.socket.send(msg, (err) => {
				if (err) {
					this.logger.error(err, 'WebSocket send error');
					this.close();
					res();
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
