import { WebSocket } from 'ws';
import { NetworkClient } from '../NetworkClient.js';
import EventEmitter from 'events';
import { pino, type Logger } from 'pino';

export default class WSClient extends EventEmitter implements NetworkClient {
	socket: WebSocket;
	ip: string;
	uuid: string;
	enforceTextOnly = true
	private logger: Logger;

	constructor(ws: WebSocket, ip: string, uuid: string) {
		super();
		this.socket = ws;
		this.ip = ip;
		this.uuid = uuid;
		this.logger = pino().child({
			name: "CVMTS.WebsocketClient",
			"uuid/websocket/client": uuid,
			src_ip: ip,
		});
		this.socket.on('message', (buf: Buffer, isBinary: boolean) => {
			// Close the user's connection if they send a binary message
			// when we are not expecting them yet.
			if (isBinary && this.enforceTextOnly) {
				this.logger.info({event: "received unexpected binary message"});
				this.close();
				return;
			}

			this.emit('msg', buf, isBinary);
		});

		this.socket.on('error', (err: Error) => {
			this.logger.error({event: "websocket recv error", msg: err});
		})

		this.socket.on('close', () => {
			this.logger.info({event: "disconnecting client"});
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
		this.logger.trace({event: "outgoing message", msg});
		return new Promise((res, rej) => {
			if (!this.isOpen()) return res();

			this.socket.send(msg, (err) => {
				if (err) {
					this.logger.error({event: "websocket send error", msg: err});
					this.close();
					res();
					return;
				}
				res();
			});
		});
	}

	sendBinary(msg: Uint8Array): Promise<void> {
		this.logger.trace({event: "outgoing message", msg});
		return new Promise((res, rej) => {
			if (!this.isOpen()) return res();

			this.socket.send(msg, (err) => {
				if (err) {
					this.logger.error({event: "websocket send error", msg: err});
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
