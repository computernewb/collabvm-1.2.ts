import {WebSocketServer, WebSocket} from 'ws';
import * as http from 'http';
import IConfig from './IConfig';
import internal from 'stream';
import * as Utilities from './Utilities';
import { User, Rank } from './User';
import * as guacutils from './guacutils';
import * as fs from 'fs';
import { CircularBuffer, Queue } from 'mnemonist';
import { createHash } from 'crypto';
import { isIP } from 'net';

export default class WSServer {
    private Config : IConfig;
    private server : http.Server;
    private socket : WebSocketServer;
    private clients : User[];
    private ChatHistory : CircularBuffer<{user:string,msg:string}>
    private TurnQueue : Queue<User>;
    private TurnTime : number;
    private TurnInterval? : NodeJS.Timer;
    private TurnIntervalRunning : boolean;
    private ModPerms : number;
    constructor(config : IConfig) {
        this.ChatHistory = new CircularBuffer<{user:string,msg:string}>(Array, 5);
        this.TurnQueue = new Queue<User>();
        this.TurnTime = 0;
        this.TurnIntervalRunning = false;
        this.clients = [];
        this.Config = config;
        this.ModPerms = Utilities.MakeModPerms(this.Config.collabvm.moderatorPermissions);
        this.server = http.createServer();
        this.socket = new WebSocketServer({noServer: true});
        this.server.on('upgrade', (req : http.IncomingMessage, socket : internal.Duplex, head : Buffer) => this.httpOnUpgrade(req, socket, head));
        this.socket.on('connection', (ws : WebSocket, req : http.IncomingMessage) => this.onConnection(ws, req));
    }

    listen() {
        this.server.listen(this.Config.http.port, this.Config.http.host);
    }

    private httpOnUpgrade(req : http.IncomingMessage, socket : internal.Duplex, head : Buffer) {
        var killConnection = () => {
            socket.write("HTTP/1.1 400 Bad Request\n\n400 Bad Request");
            socket.destroy();
        }
        if (
            req.headers['sec-websocket-protocol'] !== "guacamole" 
            // || req.headers['origin']?.toLocaleLowerCase() !== "https://computernewb.com"
        ) {
            killConnection();
            return;
        }
        if (this.Config.http.proxying) {
            // If the requesting IP isn't allowed to proxy, kill it
            //@ts-ignore
            if (this.Config.http.proxyAllowedIps.indexOf(req.socket.remoteAddress) === -1) {
                killConnection();
                return;
            }
            var _ip;
            try {
                // Get the first IP from the X-Forwarded-For variable
                _ip = req.headers["x-forwarded-for"]?.toString().replace(/\ /g, "").split(",")[0];
            } catch {
                // If we can't get the ip, kill the connection
                killConnection();
                return;
            }
            // If for some reason the IP isn't defined, kill it
            if (!_ip) {
                killConnection();
                return;
            }
            // Make sure the ip is valid. If not, kill the connection.
            if (!isIP(_ip)) {
                killConnection();
                return;
            }
            //@ts-ignore
            req.proxiedIP = _ip;
        }
        this.socket.handleUpgrade(req, socket, head, (ws) => this.socket.emit('connection', ws, req));
    }

    private onConnection(ws : WebSocket, req : http.IncomingMessage) {
        var ip;
        if (this.Config.http.proxying) {
            //@ts-ignore
            if (!req.proxiedIP) return;
            //@ts-ignore
            ip = req.proxiedIP;
        } else {
            if (!req.socket.remoteAddress) return;
            ip = req.socket.remoteAddress;
        }
        var user = new User(ws, ip, this.Config);
        this.clients.push(user);
        ws.on('close', () => this.connectionClosed(user));
        ws.on('message', (e) => {
            var msg;
            try {msg = e.toString()}
            catch {
                // Fuck the user off if they send a non-string message
                user.closeConnection();
                return;
            }
            this.onMessage(user, msg);
        });
        user.sendMsg(this.getAdduserMsg());
        console.log(`[Connect] From ${user.IP}`);
    };

    private connectionClosed(user : User) {
        this.clients.splice(this.clients.indexOf(user), 1);
        console.log(`[DISCONNECT] From ${user.IP}${user.username ? ` with username ${user.username}` : ""}`);
        if (!user.username) return;
        if (this.TurnQueue.toArray().indexOf(user) !== -1) {
            var hadturn = (this.TurnQueue.peek() === user);
            this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter(u => u !== user));
            if (hadturn) this.nextTurn();
        }
        //@ts-ignore
        this.clients.forEach((c) => c.sendMsg(guacutils.encode("remuser", "1", user.username)));
    }
    fuck = fs.readFileSync("/home/elijah/Pictures/thumb.txt").toString();
    private onMessage(client : User, message : string) {
        var msgArr = guacutils.decode(message);
        if (msgArr.length < 1) return;
        switch (msgArr[0]) {
            case "list":
                client.sendMsg(guacutils.encode("list", this.Config.collabvm.node, this.Config.collabvm.displayname, this.fuck))
                break;
            case "connect":
                if (!client.username || msgArr.length !== 2 || msgArr[1] !== this.Config.collabvm.node) {
                    client.sendMsg(guacutils.encode("connect", "0"));
                    return;
                }
                client.connectedToNode = true;
                client.sendMsg(guacutils.encode("connect", "1", "1", "1", "0"));
                if (this.Config.collabvm.motd) client.sendMsg(guacutils.encode("chat", "", this.Config.collabvm.motd));
                if (this.ChatHistory.size !== 0) client.sendMsg(this.getChatHistoryMsg());
                client.sendMsg(guacutils.encode("size", "0", "400", "300"));
                client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", this.fuck));
                break;
            case "rename":
                if (!client.RenameRateLimit.request()) return;
                // This shouldn't need a ternary but it does for some reason
                var hadName : boolean = client.username ? true : false;
                var oldname : any;
                if (hadName) oldname = client.username;
                if (msgArr.length === 1) {
                    client.assignGuestName(this.getUsernameList());
                } else {
                    var newName = msgArr[1];
                    if (hadName && newName === oldname) {
                        //@ts-ignore
                        client.sendMsg(guacutils.encode("rename", "0", "0", client.username));
                        return;
                    }
                    if (this.getUsernameList().indexOf(newName) !== -1) {
                        client.sendMsg(guacutils.encode("rename", "0", "1"));
                        return;
                    }
                    if (!/^[a-zA-Z0-9\ \-\_\.]+$/.test(newName)) {
                        client.sendMsg(guacutils.encode("rename", "0", "2"));
                        return;
                    }
                    if (this.Config.collabvm.usernameblacklist.indexOf(newName) !== -1) {
                        client.sendMsg(guacutils.encode("rename", "0", "3"));
                        return;
                    }
                    client.username = newName;
                }
                //@ts-ignore
                client.sendMsg(guacutils.encode("rename", "0", "0", client.username));
                if (hadName) {
                    console.log(`[RENAME] ${client.IP} from ${oldname} to ${client.username}`);
                    this.clients.filter(c => c.username !== client.username).forEach((c) =>
                    //@ts-ignore
                    c.sendMsg(guacutils.encode("rename", "1", oldname, client.username)));
                } else {
                    console.log(`[RENAME] ${client.IP} to ${client.username}`);
                    this.clients.forEach((c) =>
                    //@ts-ignore
                    c.sendMsg(guacutils.encode("adduser", "1", client.username, client.rank)));
                }
                break;
            case "chat":
                if (!client.username) return;
                if (client.muted) return;
                if (msgArr.length !== 2) return;
                var msg = Utilities.HTMLSanitize(msgArr[1]);
                // One of the things I hated most about the old server is it completely discarded your message if it was too long
                if (msg.length > this.Config.collabvm.maxChatLength) msg = msg.substring(0, this.Config.collabvm.maxChatLength);
                if (msg.length < 1) return;
                //@ts-ignore
                this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", client.username, msg)));
                this.ChatHistory.push({user: client.username, msg: msg});
                client.onMsgSent();
                break;
            case "turn":
                if (!client.TurnRateLimit.request()) return;
                if (!client.connectedToNode) return;
                if (msgArr.length > 2) return;
                var takingTurn : boolean;
                if (msgArr.length === 1) takingTurn = true;
                else switch (msgArr[1]) {
                    case "0":
                        takingTurn = false;
                        break;
                    case "1":
                        takingTurn = true;
                        break;
                    default:
                        return;
                        break;
                }
                if (takingTurn) {
                    // If the user is already in the queue, fuck them off
                    if (this.TurnQueue.toArray().indexOf(client) !== -1) return;
                    // If they're muted, also fuck them off.
                    // Send them the turn queue to prevent client glitches
                    if (client.muted) return;
                    this.TurnQueue.enqueue(client);
                    if (this.TurnQueue.size === 1) this.nextTurn();
                } else {
                    var hadturn = (this.TurnQueue.peek() === client);
                    this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter(u => u !== client));
                    if (hadturn) this.nextTurn();
                }
                this.sendTurnUpdate();
                break;
            case "admin":
                if (msgArr.length < 2) return;
                switch (msgArr[1]) {
                    case "2":
                        if (!client.LoginRateLimit.request()) return;
                        if (msgArr.length !== 3) return;
                        var sha256 = createHash("sha256");
                        sha256.update(msgArr[2]);
                        var pwdHash = sha256.digest('hex');
                        sha256.destroy();
                        if (pwdHash === this.Config.collabvm.adminpass) {
                            client.rank = Rank.Admin;
                            client.sendMsg(guacutils.encode("admin", "0", "1"));
                        } else if (this.Config.collabvm.moderatorEnabled && pwdHash === this.Config.collabvm.modpass) {
                            client.rank = Rank.Moderator;
                            client.sendMsg(guacutils.encode("admin", "0", "3", this.ModPerms.toString()));
                        } else {
                            client.sendMsg(guacutils.encode("admin", "0", "0"));
                            return;
                        }
                        //@ts-ignore
                        this.clients.forEach((c) => c.sendMsg(guacutils.encode("adduser", "1", client.username, client.rank)));
                        break;
                    
                }
                break;

        }
    }

    getUsernameList() : string[] {
        var arr : string[] = [];
        //@ts-ignore
        this.clients.filter(c => c.username).forEach((c) => arr.push(c.username));
        return arr;
    }
    getAdduserMsg() : string {
        var arr : string[] = ["adduser", this.clients.length.toString()];
        //@ts-ignore
        this.clients.filter(c=>c.username).forEach((c) => arr.push(c.username, c.rank));
        return guacutils.encode(...arr);
    }
    getChatHistoryMsg() : string {
        var arr : string[] = ["chat"];
        this.ChatHistory.forEach(c => arr.push(c.user, c.msg));
        return guacutils.encode(...arr);
    }
    private sendTurnUpdate() {
        var turnQueueArr = this.TurnQueue.toArray();
        var arr = ["turn", (this.TurnTime * 1000).toString(), this.TurnQueue.size.toString()];
        // @ts-ignore
        this.TurnQueue.forEach((c) => arr.push(c.username));
        var currentTurningUser = this.TurnQueue.peek();
        this.clients.filter(c => (c !== currentTurningUser && c.connectedToNode)).forEach((c) => {
            if (turnQueueArr.indexOf(c) !== -1) {
                var time = ((this.TurnTime * 1000) + ((turnQueueArr.indexOf(c) - 1) * this.Config.collabvm.turnTime * 1000));
                c.sendMsg(guacutils.encode(...arr, time.toString()));
            } else {
                c.sendMsg(guacutils.encode(...arr));
            }
        });
        if (currentTurningUser)
            currentTurningUser.sendMsg(guacutils.encode(...arr));
    }
    private nextTurn() {
        clearInterval(this.TurnInterval);
        if (this.TurnQueue.size === 0) {
            this.TurnIntervalRunning = false;
        } else {
            this.TurnTime = this.Config.collabvm.turnTime;
            this.TurnInterval = setInterval(() => this.turnInterval(), 1000);
        }
        this.sendTurnUpdate();
    }
    private turnInterval() {
        this.TurnTime--;
        if (this.TurnTime < 1) {
            this.TurnQueue.dequeue();
            this.nextTurn();
        }
    }
}