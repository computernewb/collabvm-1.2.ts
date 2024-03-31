import {WebSocketServer, WebSocket} from 'ws';
import * as http from 'http';
import IConfig from './IConfig.js';
import internal from 'stream';
import * as Utilities from './Utilities.js';
import { User, Rank } from './User.js';
import * as guacutils from './guacutils.js';
// I hate that you have to do it like this
import CircularBuffer from 'mnemonist/circular-buffer.js';
import Queue from 'mnemonist/queue.js';
import { createHash } from 'crypto';
import { isIP } from 'net';
import QEMUVM from './QEMUVM.js';
import { Canvas, createCanvas } from 'canvas';
import { IPData } from './IPData.js';
import { readFileSync } from 'fs';
import log from './log.js';
import VM from './VM.js';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class WSServer {
    private Config : IConfig;
    private server : http.Server;
    private socket : WebSocketServer;
    private clients : User[];
    private ips : IPData[];
    private ChatHistory : CircularBuffer<{user:string,msg:string}>
    private TurnQueue : Queue<User>;
    // Time remaining on the current turn
    private TurnTime : number;
    // Interval to keep track of the current turn time
    private TurnInterval? : NodeJS.Timeout;
    // If a reset vote is in progress
    private voteInProgress : boolean;
    // Interval to keep track of vote resets
    private voteInterval? : NodeJS.Timeout;
    // How much time is left on the vote
    private voteTime : number;
    // How much time until another reset vote can be cast
    private voteCooldown : number;
    // Interval to keep track
    private voteCooldownInterval? : NodeJS.Timeout;
    // Completely disable turns
    private turnsAllowed : boolean;
    // Hide the screen
    private screenHidden : boolean;
    // base64 image to show when the screen is hidden
    private screenHiddenImg : string;
    private screenHiddenThumb : string;
    // Indefinite turn
    private indefiniteTurn : User | null;
    private ModPerms : number;  
    private VM : VM;
    constructor(config : IConfig, vm : VM) {
        this.Config = config;
        this.ChatHistory = new CircularBuffer<{user:string,msg:string}>(Array, this.Config.collabvm.maxChatHistoryLength);
        this.TurnQueue = new Queue<User>();
        this.TurnTime = 0;
        this.clients = [];
        this.ips = [];
        this.voteInProgress = false;
        this.voteTime = 0;
        this.voteCooldown = 0;
        this.turnsAllowed = true;
        this.screenHidden = false;
        this.screenHiddenImg = readFileSync(__dirname + "/../assets/screenhidden.jpeg").toString("base64");
        this.screenHiddenThumb = readFileSync(__dirname + "/../assets/screenhiddenthumb.jpeg").toString("base64");

        this.indefiniteTurn = null;
        this.ModPerms = Utilities.MakeModPerms(this.Config.collabvm.moderatorPermissions);
        this.server = http.createServer();
        this.socket = new WebSocketServer({noServer: true});
        this.server.on('upgrade', (req : http.IncomingMessage, socket : internal.Duplex, head : Buffer) => this.httpOnUpgrade(req, socket, head));
        this.server.on('request', (req, res) => {
            res.writeHead(426);
            res.write("This server only accepts WebSocket connections.");
            res.end();
        });
        var initSize = vm.getSize();
        this.newsize(initSize);
        this.VM = vm;
        this.VM.on("dirtyrect", (j, x, y) => this.newrect(j, x, y));
        this.VM.on("size", (s) => this.newsize(s));
    }

    listen() {
        this.server.listen(this.Config.http.port, this.Config.http.host);
    }

    private httpOnUpgrade(req : http.IncomingMessage, socket : internal.Duplex, head : Buffer) {
        var killConnection = () => {
            socket.write("HTTP/1.1 400 Bad Request\n\n400 Bad Request");
            socket.destroy();
        }

        if (req.headers['sec-websocket-protocol'] !== "guacamole") {
            killConnection();
            return;
        }

        if (this.Config.http.origin) {
            // If the client is not sending an Origin header, kill the connection.
            if(!req.headers.origin) {
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
            if (_uri.pathname !== "/" || _uri.search !== "") {
                killConnection();
                return;
            }
            
            // If the domain name is not in the list of allowed origins, kill the connection.
            if(!this.Config.http.originAllowedDomains.includes(_host)) {
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
            if (req.headers["x-forwarded-for"] === undefined) {
                killConnection();
                return;
            }
            try {
                // Get the first IP from the X-Forwarded-For variable
                ip = req.headers["x-forwarded-for"]?.toString().replace(/\ /g, "").split(",")[0];
            } catch {
                // If we can't get the IP, kill the connection
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

        // Get the amount of active connections coming from the requesting IP.
        let connections = this.clients.filter(client => client.IP.address == ip);
        // If it exceeds the limit set in the config, reject the connection with a 429.
        if(connections.length + 1 > this.Config.http.maxConnections) {
            socket.write("HTTP/1.1 429 Too Many Requests\n\n429 Too Many Requests");
            socket.destroy();
        }

        this.socket.handleUpgrade(req, socket, head, (ws: WebSocket) => {
            this.socket.emit('connection', ws, req);
            this.onConnection(ws, req, ip);
        });
    }

    private onConnection(ws : WebSocket, req: http.IncomingMessage, ip : string) {
        
        var _ipdata = this.ips.filter(data => data.address == ip);
        var ipdata;
        if(_ipdata.length > 0) {
            ipdata = _ipdata[0];
        }else{
            
            ipdata = new IPData(ip);
            this.ips.push(ipdata);
        }

        var user = new User(ws, ipdata, this.Config);
        this.clients.push(user);
        ws.on('error', (e) => {
            
            log("ERROR", `${e} (caused by connection ${ip})`);
            ws.close();
        });
        ws.on('close', () => this.connectionClosed(user));
        ws.on('message', (e) => {
            var msg;
            try {msg = e.toString()}
            catch {
                // Close the user's connection if they send a non-string message
                user.closeConnection();
                return;
            }
            this.onMessage(user, msg);
        });
        user.sendMsg(this.getAdduserMsg());
        log("INFO", `Connect from ${user.IP.address}`);
    };

    private connectionClosed(user : User) {
        if(user.IP.vote != null) {
            user.IP.vote = null;
            this.sendVoteUpdate();
        };
        if (this.indefiniteTurn === user) this.indefiniteTurn = null;
        this.clients.splice(this.clients.indexOf(user), 1);
        log("INFO", `Disconnect From ${user.IP.address}${user.username ? ` with username ${user.username}` : ""}`);
        if (!user.username) return;
        if (this.TurnQueue.toArray().indexOf(user) !== -1) {
            var hadturn = (this.TurnQueue.peek() === user);
            this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter(u => u !== user));
            if (hadturn) this.nextTurn();
        }
        
        this.clients.forEach((c) => c.sendMsg(guacutils.encode("remuser", "1", user.username!)));
    }
    private async onMessage(client : User, message : string) {
        var msgArr = guacutils.decode(message);
        if (msgArr.length < 1) return;
        switch (msgArr[0]) {
            case "list":
                client.sendMsg(guacutils.encode("list", this.Config.collabvm.node, this.Config.collabvm.displayname, this.screenHidden ? this.screenHiddenThumb : await this.getThumbnail()));
                break;
            case "connect":
                if (!client.username || msgArr.length !== 2 || msgArr[1] !== this.Config.collabvm.node) {
                    client.sendMsg(guacutils.encode("connect", "0"));
                    return;
                }
                client.connectedToNode = true;
                client.sendMsg(guacutils.encode("connect", "1", "1", this.Config.vm.snapshots ? "1" : "0", "0"));
                if (this.ChatHistory.size !== 0) client.sendMsg(this.getChatHistoryMsg());
                if (this.Config.collabvm.motd) client.sendMsg(guacutils.encode("chat", "", this.Config.collabvm.motd));
                if (this.screenHidden) {
                    client.sendMsg(guacutils.encode("size", "0", "1024", "768"));
                    client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", this.screenHiddenImg));
                } else {
                    client.sendMsg(guacutils.encode("size", "0", this.VM.framebuffer.width.toString(), this.VM.framebuffer.height.toString()));
                    var jpg = this.VM.framebuffer.toBuffer("image/jpeg");
                    var jpg64 = jpg.toString("base64");
                    client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", jpg64));
                }
                client.sendMsg(guacutils.encode("sync", Date.now().toString()));
                if (this.voteInProgress) this.sendVoteUpdate(client);
                this.sendTurnUpdate(client);
                break;
            case "view":
                if(client.connectedToNode) return;
                if(client.username || msgArr.length !== 3 || msgArr[1] !== this.Config.collabvm.node) {
                    // The use of connect here is intentional.
                    client.sendMsg(guacutils.encode("connect", "0"));
                    return;
                }

                switch(msgArr[2]) {
                    case "0":
                        client.viewMode = 0;
                        break;
                    case "1":
                        client.viewMode = 1;
                        break;
                    default:
                        client.sendMsg(guacutils.encode("connect", "0"));
                        return;
                }
                
                client.sendMsg(guacutils.encode("connect", "1", "1", this.Config.vm.snapshots ? "1" : "0", "0"));
                if (this.ChatHistory.size !== 0) client.sendMsg(this.getChatHistoryMsg());
                if (this.Config.collabvm.motd) client.sendMsg(guacutils.encode("chat", "", this.Config.collabvm.motd));
                
                if(client.viewMode == 1) {
                    if (this.screenHidden) {
                        client.sendMsg(guacutils.encode("size", "0", "1024", "768"));
                        client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", this.screenHiddenImg));
                    } else {
                        client.sendMsg(guacutils.encode("size", "0", this.VM.framebuffer.width.toString(), this.VM.framebuffer.height.toString()));
                        var jpg = this.VM.framebuffer.toBuffer("image/jpeg");
                        var jpg64 = jpg.toString("base64");
                        client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", jpg64));
                    }
                        client.sendMsg(guacutils.encode("sync", Date.now().toString()));
                }
                
                if (this.voteInProgress) this.sendVoteUpdate(client);
                this.sendTurnUpdate(client);
                break;
            case "rename":
                if (!client.RenameRateLimit.request()) return;
                if (client.connectedToNode && client.IP.muted) return;
                this.renameUser(client, msgArr[1]);
                break;
            case "chat":
                if (!client.username) return;
                if (client.IP.muted) return;
                if (msgArr.length !== 2) return;
                var msg = Utilities.HTMLSanitize(msgArr[1]);
                // One of the things I hated most about the old server is it completely discarded your message if it was too long
                if (msg.length > this.Config.collabvm.maxChatLength) msg = msg.substring(0, this.Config.collabvm.maxChatLength);
                if (msg.trim().length < 1) return;
                
                this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", client.username!, msg)));
                this.ChatHistory.push({user: client.username, msg: msg});
                client.onMsgSent();
                break;
            case "turn":
                if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && client.rank !== Rank.Admin && client.rank !== Rank.Moderator && client.rank !== Rank.Turn) return;
                if (!client.TurnRateLimit.request()) return;
                if (!client.connectedToNode) return;
                if (msgArr.length > 2) return;
                var takingTurn : boolean;
                if (msgArr.length === 1) takingTurn = true;
                else switch (msgArr[1]) {
                    case "0":
                        if (this.indefiniteTurn === client) {
                            this.indefiniteTurn = null;
                        }
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
                    var currentQueue = this.TurnQueue.toArray();
                    // If the user is already in the turn queue, ignore the turn request.
                    if (currentQueue.indexOf(client) !== -1) return;
                    // If they're muted, also ignore the turn request.
                    // Send them the turn queue to prevent client glitches
                    if (client.IP.muted) return;
                    if(this.Config.collabvm.turnlimit.enabled) {
                        // Get the amount of users in the turn queue with the same IP as the user requesting a turn.
                        let turns = currentQueue.filter(user => user.IP.address == client.IP.address);
                        // If it exceeds the limit set in the config, ignore the turn request.
                        if(turns.length + 1 > this.Config.collabvm.turnlimit.maximum) return;
                    }
                    this.TurnQueue.enqueue(client);
                    if (this.TurnQueue.size === 1) this.nextTurn();
                } else {
                    var hadturn = (this.TurnQueue.peek() === client);
                    this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter(u => u !== client));
                    if (hadturn) this.nextTurn();
                }
                this.sendTurnUpdate();
                break;
            case "mouse":
                if (this.TurnQueue.peek() !== client && client.rank !== Rank.Admin) return;
                if (!this.VM.acceptingInput()) return;
                var x = parseInt(msgArr[1]);
                var y = parseInt(msgArr[2]);
                var mask = parseInt(msgArr[3]);
                if (x === undefined || y === undefined || mask === undefined) return;
                this.VM.pointerEvent(x, y, mask);
                break;
            case "key":
                if (this.TurnQueue.peek() !== client && client.rank !== Rank.Admin) return;
                if (!this.VM.acceptingInput()) return;
                var keysym = parseInt(msgArr[1]);
                var down = parseInt(msgArr[2]);
                if (keysym === undefined || (down !== 0 && down !== 1)) return;
                this.VM.keyEvent(keysym, down === 1 ? true : false);
                break;
            case "vote":
                if (!this.Config.vm.snapshots) return;
                if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && client.rank !== Rank.Admin && client.rank !== Rank.Moderator && client.rank !== Rank.Turn) return;
                if (!client.connectedToNode) return;
                if (msgArr.length !== 2) return;
                if (!client.VoteRateLimit.request()) return;
                switch (msgArr[1]) {
                    case "1":
                        if (!this.voteInProgress) {
                            if (this.voteCooldown !== 0) {
                                client.sendMsg(guacutils.encode("vote", "3", this.voteCooldown.toString()));
                                return;
                            }
                            this.startVote();
                            this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", "", `${client.username} has started a vote to reset the VM.`)));
                        }
                        else if (client.IP.vote !== true)
                            this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", "", `${client.username} has voted yes.`)));
                        client.IP.vote = true;
                        break;
                    case "0":
                        if (!this.voteInProgress) return;
                        if (client.IP.vote !== false)
                            this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", "", `${client.username} has voted no.`)));
                        client.IP.vote = false;
                        break;
                }
                this.sendVoteUpdate();
                break;
            case "admin":
                if (msgArr.length < 2) return;
                switch (msgArr[1]) {
                    case "2":
                        // Login
                        if (!client.LoginRateLimit.request() || !client.username) return;
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
                        } else if (this.Config.collabvm.turnwhitelist && pwdHash === this.Config.collabvm.turnpass) {
                            client.rank = Rank.Turn;
                            client.sendMsg(guacutils.encode("chat", "", "You may now take turns."));
                        } else {
                            client.sendMsg(guacutils.encode("admin", "0", "0"));
                            return;
                        }
                        if (this.screenHidden) {
                            client.sendMsg(guacutils.encode("size", "0", this.VM.framebuffer.width.toString(), this.VM.framebuffer.height.toString()));
                            var jpg = this.VM.framebuffer.toBuffer("image/jpeg");
                            var jpg64 = jpg.toString("base64");
                            client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", jpg64));
                            client.sendMsg(guacutils.encode("sync", Date.now().toString()));
                        }
                        
                        this.clients.forEach((c) => c.sendMsg(guacutils.encode("adduser", "1", client.username!, client.rank.toString())));
                        break;
                    case "5":
                        // QEMU Monitor
                        if (client.rank !== Rank.Admin) return;
                        if (!(this.VM instanceof QEMUVM)) {
                            client.sendMsg(guacutils.encode("admin", "2", "This is not a QEMU VM and therefore QEMU monitor commands cannot be run."));
                            return;
                        }
                        if (msgArr.length !== 4 || msgArr[2] !== this.Config.collabvm.node) return;
                        var output = await this.VM.qmpClient.runMonitorCmd(msgArr[3]);
                        client.sendMsg(guacutils.encode("admin", "2", String(output)));
                        break;
                    case "8":
                        // Restore
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.restore)) return;
                        this.VM.Restore();
                        break;
                    case "10":
                        // Reboot
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.reboot)) return;
                        if (msgArr.length !== 3 || msgArr[2] !== this.Config.collabvm.node) return;
                        this.VM.Reboot();
                        break;
                    case "12":
                        // Ban
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.ban)) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        user.ban();
                    case "13":
                        // Force Vote
                        if (msgArr.length !== 3) return;
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.forcevote)) return;
                        if (!this.voteInProgress) return;
                        switch (msgArr[2]) {
                            case "1":
                                this.endVote(true);
                                break;
                            case "0":
                                this.endVote(false);
                                break;
                        }
                        break;
                    case "14":
                        // Mute
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.mute)) return;
                        if (msgArr.length !== 4) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        var permamute;
                        switch (msgArr[3]) {
                            case "0":
                                permamute = false;
                                break;
                            case "1":
                                permamute = true;
                                break;
                            default:
                                return;
                        }
                        user.mute(permamute);
                        break;
                    case "15":
                        // Kick
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.kick)) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        user.kick();
                        break;
                    case "16":
                        // End turn
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
                        if (msgArr.length !== 3) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        this.endTurn(user);
                        break;
                    case "17":
                        // Clear turn queue
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
                        if (msgArr.length !== 3 || msgArr[2] !== this.Config.collabvm.node) return;
                        this.clearTurns();
                        break;
                    case "18":
                        // Rename user
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.rename)) return;
                        if (msgArr.length !== 4) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        this.renameUser(user, msgArr[3]);
                        break;
                    case "19":
                        // Get IP
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.grabip)) return;
                        if (msgArr.length !== 3) return;
                        var user = this.clients.find(c => c.username === msgArr[2]);
                        if (!user) return;
                        client.sendMsg(guacutils.encode("admin", "19", msgArr[2], user.IP.address));
                        break;
                    case "20":
                        // Steal turn
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
                        this.bypassTurn(client);
                        break;
                    case "21":
                        // XSS
                        if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.xss)) return;
                        if (msgArr.length !== 3) return;
                        switch (client.rank) {
                            case Rank.Admin:
                                
                                this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", client.username!, msgArr[2])));
                                
                                this.ChatHistory.push({user: client.username!, msg: msgArr[2]});
                                break;
                            case Rank.Moderator:
                                
                                this.clients.filter(c => c.rank !== Rank.Admin).forEach(c => c.sendMsg(guacutils.encode("chat", client.username!, msgArr[2])));
                                
                                this.clients.filter(c => c.rank === Rank.Admin).forEach(c => c.sendMsg(guacutils.encode("chat", client.username!, Utilities.HTMLSanitize(msgArr[2]))));
                                break;
                        }
                        break;
                    case "22":
                        // Toggle turns
                        if (client.rank !== Rank.Admin) return;
                        if (msgArr.length !== 3) return;
                        switch (msgArr[2]) {
                            case "0":
                                this.clearTurns();
                                this.turnsAllowed = false;
                                break;
                            case "1":
                                this.turnsAllowed = true;
                                break;
                        }
                        break;
                    case "23":
                        // Indefinite turn
                        if (client.rank !== Rank.Admin) return;
                        this.indefiniteTurn = client;
                        this.TurnQueue = Queue.from([client, ...this.TurnQueue.toArray().filter(c=>c!==client)]);
                        this.sendTurnUpdate();
                        break;
                    case "24":
                        // Hide screen
                        if (client.rank !== Rank.Admin) return;
                        if (msgArr.length !== 3) return;
                        switch (msgArr[2]) {
                            case "0":
                                    this.screenHidden = true;
                                    this.clients.filter(c => c.rank == Rank.Unregistered).forEach(client => {
                                        client.sendMsg(guacutils.encode("size", "0", "1024", "768"));
                                        client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", this.screenHiddenImg));
                                        client.sendMsg(guacutils.encode("sync", Date.now().toString()));
                                    });
                                break;
                            case "1":
                                    this.screenHidden = false;
                                    this.clients.forEach(client => {
                                        client.sendMsg(guacutils.encode("size", "0", this.VM.framebuffer.width.toString(), this.VM.framebuffer.height.toString()));
                                        var jpg = this.VM.framebuffer.toBuffer("image/jpeg");
                                        var jpg64 = jpg.toString("base64");
                                        client.sendMsg(guacutils.encode("png", "0", "0", "0", "0", jpg64));
                                        client.sendMsg(guacutils.encode("sync", Date.now().toString()));
                                    });
                                break;
                        }
                        break;
                }
                break;

        }
    }

    getUsernameList() : string[] {
        var arr : string[] = [];
        
        this.clients.filter(c => c.username).forEach((c) => arr.push(c.username!));
        return arr;
    }

    renameUser(client : User, newName? : string) {
        // This shouldn't need a ternary but it does for some reason
        var hadName : boolean = client.username ? true : false;
        var oldname : any;
        if (hadName) oldname = client.username;
        var status = "0";
        if (!newName) {
            client.assignGuestName(this.getUsernameList());
        } else {
            newName = newName.trim();
            if (hadName && newName === oldname) {
                
                client.sendMsg(guacutils.encode("rename", "0", "0", client.username!, client.rank.toString()));
                return;
            }
            if (this.getUsernameList().indexOf(newName) !== -1) {
                client.assignGuestName(this.getUsernameList());
                if(client.connectedToNode) {
                    status = "1";
                }
            } else
            if (!/^[a-zA-Z0-9\ \-\_\.]+$/.test(newName) || newName.length > 20 || newName.length < 3) {
                client.assignGuestName(this.getUsernameList());
                status = "2";
            } else
            if (this.Config.collabvm.usernameblacklist.indexOf(newName) !== -1) {
                client.assignGuestName(this.getUsernameList());
                status = "3";
            } else client.username = newName;
        }
        
        client.sendMsg(guacutils.encode("rename", "0", status, client.username!, client.rank.toString()));
        if (hadName) {
            log("INFO", `Rename ${client.IP.address} from ${oldname} to ${client.username}`);
            this.clients.forEach((c) =>
            
            c.sendMsg(guacutils.encode("rename", "1", oldname, client.username!, client.rank.toString())));
        } else {
            log("INFO", `Rename ${client.IP.address} to ${client.username}`);
            this.clients.forEach((c) =>
            
            c.sendMsg(guacutils.encode("adduser", "1", client.username!, client.rank.toString())));
        }
    }

    getAdduserMsg() : string {
        var arr : string[] = ["adduser", this.clients.filter(c=>c.username).length.toString()];
        
        this.clients.filter(c=>c.username).forEach((c) => arr.push(c.username!, c.rank.toString()));
        return guacutils.encode(...arr);
    }
    getChatHistoryMsg() : string {
        var arr : string[] = ["chat"];
        this.ChatHistory.forEach(c => arr.push(c.user, c.msg));
        return guacutils.encode(...arr);
    }
    private sendTurnUpdate(client? : User) {
        var turnQueueArr = this.TurnQueue.toArray();
        var turntime;
        if (this.indefiniteTurn === null) turntime = (this.TurnTime * 1000);
        else turntime = 9999999999;
        var arr = ["turn", turntime.toString(), this.TurnQueue.size.toString()];
        // @ts-ignore
        this.TurnQueue.forEach((c) => arr.push(c.username));
        var currentTurningUser = this.TurnQueue.peek();
        if (client) {
            client.sendMsg(guacutils.encode(...arr));
            return;
        }
        this.clients.filter(c => (c !== currentTurningUser && c.connectedToNode)).forEach((c) => {
            if (turnQueueArr.indexOf(c) !== -1) {
                var time;
                if (this.indefiniteTurn === null) time = ((this.TurnTime * 1000) + ((turnQueueArr.indexOf(c) - 1) * this.Config.collabvm.turnTime * 1000));
                else time = 9999999999;
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
        } else {
            this.TurnTime = this.Config.collabvm.turnTime;
            this.TurnInterval = setInterval(() => this.turnInterval(), 1000);
        }
        this.sendTurnUpdate();
    }

    clearTurns() {
        clearInterval(this.TurnInterval);
        this.TurnQueue.clear();
        this.sendTurnUpdate();
    }

    bypassTurn(client : User) {
        var a = this.TurnQueue.toArray().filter(c => c !== client);
        this.TurnQueue = Queue.from([client, ...a]);
        this.nextTurn();
    }

    endTurn(client : User) {
        var hasTurn = (this.TurnQueue.peek() === client);
        this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter(c => c !== client));
        if (hasTurn) this.nextTurn();
        else this.sendTurnUpdate();
    }

    private turnInterval() {
        if (this.indefiniteTurn !== null) return;
        this.TurnTime--;
        if (this.TurnTime < 1) {
            this.TurnQueue.dequeue();
            this.nextTurn();
        }
    }

    private async newrect(rect : Canvas, x : number, y : number) {
        var jpg = rect.toBuffer("image/jpeg", {quality: 0.5, progressive: true, chromaSubsampling: true});
        var jpg64 = jpg.toString("base64");
        this.clients.filter(c => c.connectedToNode || c.viewMode == 1).forEach(c => {
            if (this.screenHidden && c.rank == Rank.Unregistered) return;
            c.sendMsg(guacutils.encode("png", "0", "0", x.toString(), y.toString(), jpg64));
            c.sendMsg(guacutils.encode("sync", Date.now().toString()));
        });
    }

    private newsize(size : {height:number,width:number}) {
        this.clients.filter(c => c.connectedToNode || c.viewMode == 1).forEach(c => {
            if (this.screenHidden && c.rank == Rank.Unregistered) return;
            c.sendMsg(guacutils.encode("size", "0", size.width.toString(), size.height.toString()))
        });
    }

    getThumbnail() : Promise<string> {
        return new Promise(async (res, rej) => {
            var cnv = createCanvas(400, 300);
            var ctx = cnv.getContext("2d");
            ctx.drawImage(this.VM.framebuffer, 0, 0, 400, 300);
            var jpg = cnv.toBuffer("image/jpeg");
            res(jpg.toString("base64"));
        })
    }

    startVote() {
        if (this.voteInProgress) return;
        this.voteInProgress = true;
        this.clients.forEach(c => c.sendMsg(guacutils.encode("vote", "0")));
        this.voteTime = this.Config.collabvm.voteTime;
        this.voteInterval = setInterval(() => {
            this.voteTime--;
            if (this.voteTime < 1) {
                this.endVote();
            }
        }, 1000);
    }

    endVote(result? : boolean) {
        if (!this.voteInProgress) return;
        this.voteInProgress = false;
        clearInterval(this.voteInterval);
        var count = this.getVoteCounts();
        this.clients.forEach((c) => c.sendMsg(guacutils.encode("vote", "2")));
        if (result === true || (result === undefined && count.yes >= count.no)) {
            this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", "", "The vote to reset the VM has won.")));
            this.VM.Restore();
        } else {
            this.clients.forEach(c => c.sendMsg(guacutils.encode("chat", "", "The vote to reset the VM has lost.")));
        }
        this.clients.forEach(c => {
            c.IP.vote = null;
        });
        this.voteCooldown = this.Config.collabvm.voteCooldown;
        this.voteCooldownInterval = setInterval(() => {
            this.voteCooldown--;
            if (this.voteCooldown < 1)
                clearInterval(this.voteCooldownInterval);
        }, 1000);
    }

    sendVoteUpdate(client? : User) {
        if (!this.voteInProgress) return;
        var count = this.getVoteCounts();
        var msg = guacutils.encode("vote", "1", (this.voteTime * 1000).toString(), count.yes.toString(), count.no.toString());
        if (client)
            client.sendMsg(msg);
        else
            this.clients.forEach((c) => c.sendMsg(msg));
    }

    getVoteCounts() : {yes:number,no:number} {
        var yes = 0;
        var no = 0;
        this.ips.forEach((c) => {
            if (c.vote === true) yes++;
            if (c.vote === false) no++;
        });
        return {yes:yes,no:no};
    }
}
