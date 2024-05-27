import EventEmitter from "events";
import NetworkServer from "../NetworkServer.js";
import { Server, Socket } from "net";
import IConfig from "../IConfig.js";
import { Logger } from "@cvmts/shared";
import TCPClient from "./TCPClient.js";
import { IPDataManager } from "../IPData.js";
import { User } from "../User.js";

export default class TCPServer extends EventEmitter implements NetworkServer {
    listener: Server;
    Config: IConfig;
    logger: Logger;
    clients: TCPClient[];

    constructor(config: IConfig) {
        super();
        this.logger = new Logger("CVMTS.TCPServer");
        this.Config = config;
        this.listener = new Server();
        this.clients = [];
        this.listener.on('connection', socket => this.onConnection(socket));
    }

    private onConnection(socket: Socket) {
        this.logger.Info(`New TCP connection from ${socket.remoteAddress}`);
        var client = new TCPClient(socket);
        this.clients.push(client);
        this.emit('connect', new User(client, IPDataManager.GetIPData(client.getIP()), this.Config));
    }

    start(): void {
        this.listener.listen(this.Config.tcp.port, this.Config.tcp.host, () => {
            this.logger.Info(`TCP server listening on ${this.Config.tcp.host}:${this.Config.tcp.port}`);
        })
    }
    stop(): void {
        this.listener.close();
    }
}