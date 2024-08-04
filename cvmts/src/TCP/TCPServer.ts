import EventEmitter from 'events';
import NetworkServer from '../NetworkServer.js';
import { Server, Socket } from 'net';
import IConfig from '../IConfig.js';
import TCPClient from './TCPClient.js';
import { IPDataManager } from '../IPData.js';
import { User } from '../User.js';
import pino from 'pino';
import { BanManager } from '../BanManager.js';

export default class TCPServer extends EventEmitter implements NetworkServer {
	listener: Server;
	Config: IConfig;
	logger = pino({ name: 'CVMTS.TCPServer' });
	clients: TCPClient[];
	private banmgr: BanManager;

	constructor(config: IConfig, banmgr: BanManager) {
		super();
		this.Config = config;
		this.listener = new Server();
		this.clients = [];
		this.listener.on('connection', (socket) => this.onConnection(socket));
		this.banmgr = banmgr;
	}

	private async onConnection(socket: Socket) {
		this.logger.info(`New TCP connection from ${socket.remoteAddress}`);
		if (await this.banmgr.isIPBanned(socket.remoteAddress!)) {
			socket.write('6.banned;');
			socket.destroy();
			return;
		}
		var client = new TCPClient(socket);
		this.clients.push(client);
		this.emit('connect', new User(client, IPDataManager.GetIPData(client.getIP()), this.Config));
	}

	start(): void {
		this.listener.listen(this.Config.tcp.port, this.Config.tcp.host, () => {
			this.logger.info(`TCP server listening on ${this.Config.tcp.host}:${this.Config.tcp.port}`);
		});
	}
	stop(): void {
		this.listener.close();
	}
}
