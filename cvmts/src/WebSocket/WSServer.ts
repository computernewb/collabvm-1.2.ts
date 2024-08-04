import * as http from 'http';
import NetworkServer from '../NetworkServer.js';
import EventEmitter from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import internal from 'stream';
import IConfig from '../IConfig.js';
import { isIP } from 'net';
import { IPDataManager } from '../IPData.js';
import WSClient from './WSClient.js';
import { User } from '../User.js';
import pino from 'pino';
import { BanManager } from '../BanManager.js';

export default class WSServer extends EventEmitter implements NetworkServer {
	private httpServer: http.Server;
	private wsServer: WebSocketServer;
	private clients: WSClient[];
	private Config: IConfig;
	private logger = pino({ name: 'CVMTS.WSServer' });
	private banmgr: BanManager;

	constructor(config: IConfig, banmgr: BanManager) {
		super();
		this.Config = config;
		this.clients = [];
		this.httpServer = http.createServer();
		this.wsServer = new WebSocketServer({ noServer: true });
		this.httpServer.on('upgrade', (req: http.IncomingMessage, socket: internal.Duplex, head: Buffer) => this.httpOnUpgrade(req, socket, head));
		this.httpServer.on('request', (req, res) => {
			res.writeHead(426);
			res.write('This server only accepts WebSocket connections.');
			res.end();
		});
		this.banmgr = banmgr;
	}

	start(): void {
		this.httpServer.listen(this.Config.http.port, this.Config.http.host, () => {
			this.logger.info(`WebSocket server listening on ${this.Config.http.host}:${this.Config.http.port}`);
		});
	}

	stop(): void {
		this.httpServer.close();
	}

	private async httpOnUpgrade(req: http.IncomingMessage, socket: internal.Duplex, head: Buffer) {
		var killConnection = () => {
			socket.write('HTTP/1.1 400 Bad Request\n\n400 Bad Request');
			socket.destroy();
		};

		if (req.headers['sec-websocket-protocol'] !== 'guacamole') {
			killConnection();
			return;
		}

		if (this.Config.http.origin) {
			// If the client is not sending an Origin header, kill the connection.
			if (!req.headers.origin) {
				killConnection();
				return;
			}

			// Try to parse the Origin header sent by the client, if it fails, kill the connection.
			var _uri;
			var _host;
			try {
				_uri = new URL(req.headers.origin.toLowerCase());
				_host = _uri.host;
			} catch {
				killConnection();
				return;
			}

			// detect fake origin headers
			if (_uri.pathname !== '/' || _uri.search !== '') {
				killConnection();
				return;
			}

			// If the domain name is not in the list of allowed origins, kill the connection.
			if (!this.Config.http.originAllowedDomains.includes(_host)) {
				killConnection();
				return;
			}
		}

		let ip: string;
		if (this.Config.http.proxying) {
			// If the requesting IP isn't allowed to proxy, kill it
			if (this.Config.http.proxyAllowedIps.indexOf(req.socket.remoteAddress!) === -1) {
				killConnection();
				return;
			}
			// Make sure x-forwarded-for is set
			if (req.headers['x-forwarded-for'] === undefined) {
				killConnection();
				this.logger.error('X-Forwarded-For header not set. This is most likely a misconfiguration of your reverse proxy.');
				return;
			}
			try {
				// Get the first IP from the X-Forwarded-For variable
				ip = req.headers['x-forwarded-for']?.toString().replace(/\ /g, '').split(',')[0];
			} catch {
				// If we can't get the IP, kill the connection
				this.logger.error('Invalid X-Forwarded-For header. This is most likely a misconfiguration of your reverse proxy.');
				killConnection();
				return;
			}
			// If for some reason the IP isn't defined, kill it
			if (!ip) {
				killConnection();
				return;
			}
			// Make sure the IP is valid. If not, kill the connection.
			if (!isIP(ip)) {
				killConnection();
				return;
			}
		} else {
			if (!req.socket.remoteAddress) return;
			ip = req.socket.remoteAddress;
		}

		if (await this.banmgr.isIPBanned(ip)) {
			socket.write('HTTP/1.1 403 Forbidden\n\nYou have been banned.');
			socket.destroy();
			return;
		}

		this.wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
			this.wsServer.emit('connection', ws, req);
			this.onConnection(ws, req, ip);
		});
	}

	private onConnection(ws: WebSocket, req: http.IncomingMessage, ip: string) {
		let client = new WSClient(ws, ip);
		this.clients.push(client);
		let user = new User(client, IPDataManager.GetIPData(ip), this.Config);

		this.emit('connect', user);

		ws.on('error', (e) => {
			this.logger.error(`${e} (caused by connection ${ip})`);
			ws.close();
		});

		this.logger.info(`New WebSocket connection from ${user.IP.address}`);
	}
}
