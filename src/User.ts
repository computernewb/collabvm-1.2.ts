import * as Utilities from './Utilities.js';
import * as guacutils from './guacutils.js';
import {WebSocket} from 'ws';
import {IPData} from './IPData.js';
import IConfig from './IConfig.js';
import RateLimiter from './RateLimiter.js';
import { execaCommand } from 'execa';
export class User {
    socket : WebSocket;
    nopSendInterval : NodeJS.Timer;
    msgRecieveInterval : NodeJS.Timer;
    nopRecieveTimeout? : NodeJS.Timer;
    username? : string;
    connectedToNode : boolean;
    viewMode : number;
    rank : Rank;
    msgsSent : number;
    Config : IConfig;
    IP : IPData;
    // Rate limiters
    ChatRateLimit : RateLimiter;
    LoginRateLimit : RateLimiter;
    RenameRateLimit : RateLimiter;
    TurnRateLimit : RateLimiter;
    VoteRateLimit : RateLimiter;
    constructor(ws : WebSocket, ip : IPData, config : IConfig, username? : string, node? : string) {
        this.IP = ip;
        this.connectedToNode = false;
        this.viewMode = -1;
        this.Config = config;
        this.socket = ws;
        this.msgsSent = 0;
        this.socket.on('close', () => {
            clearInterval(this.nopSendInterval);
        });
        this.socket.on('message', (e) => {
            clearTimeout(this.nopRecieveTimeout);
            clearInterval(this.msgRecieveInterval);
            this.msgRecieveInterval = setInterval(() => this.onNoMsg(), 10000);
        })
        this.nopSendInterval = setInterval(() => this.sendNop(), 5000);
        this.msgRecieveInterval = setInterval(() => this.onNoMsg(), 10000);
        this.sendNop();
        if (username) this.username = username;
        this.rank = 0;
        this.ChatRateLimit = new RateLimiter(this.Config.collabvm.automute.messages, this.Config.collabvm.automute.seconds);
        this.ChatRateLimit.on('limit', () => this.mute(false));
        this.RenameRateLimit = new RateLimiter(3, 60);
        this.RenameRateLimit.on('limit', () => this.closeConnection());
        this.LoginRateLimit = new RateLimiter(4, 3);
        this.LoginRateLimit.on('limit', () => this.closeConnection());
        this.TurnRateLimit = new RateLimiter(5, 3);
        this.TurnRateLimit.on('limit', () => this.closeConnection());
        this.VoteRateLimit = new RateLimiter(3, 3);
        this.VoteRateLimit.on('limit', () => this.closeConnection());
    }
    assignGuestName(existingUsers : string[]) : string {
        var username;
        do {
            username = "guest" + Utilities.Randint(10000, 99999);
        } while (existingUsers.indexOf(username) !== -1);
        this.username = username;
        return username;
    }
    sendNop() {
        this.socket.send("3.nop;");
    }
    sendMsg(msg : string | Buffer) {
        if (this.socket.readyState !== this.socket.OPEN) return;
        clearInterval(this.nopSendInterval);
        this.nopSendInterval = setInterval(() => this.sendNop(), 5000);
        this.socket.send(msg);
    }
    private onNoMsg() {
        this.sendNop();
        this.nopRecieveTimeout = setTimeout(() => {
            this.closeConnection();
        }, 3000);
    }
    closeConnection() {
        this.socket.send(guacutils.encode("disconnect"));
        this.socket.close();
    }
    onMsgSent() {
        if (!this.Config.collabvm.automute.enabled) return;
        if (this.rank !== 0) return;
        this.ChatRateLimit.request();
    }
    mute(permanent : boolean) {
        this.IP.muted = true;
        this.sendMsg(guacutils.encode("chat", "", `You have been muted${permanent ? "" : ` for ${this.Config.collabvm.tempMuteTime} seconds`}.`));
        if (!permanent) {
            clearTimeout(this.IP.tempMuteExpireTimeout);
            this.IP.tempMuteExpireTimeout = setTimeout(() => this.unmute(), this.Config.collabvm.tempMuteTime * 1000);
        }
    }
    unmute() {
        clearTimeout(this.IP.tempMuteExpireTimeout);
        this.IP.muted = false;
        this.sendMsg(guacutils.encode("chat", "", "You are no longer muted."));
    }

    async ban() {
        // Prevent the user from taking turns or chatting, in case the ban command takes a while
        this.IP.muted = true;
        //@ts-ignore
        var cmd = this.Config.collabvm.bancmd.replace(/\$IP/g, this.IP.address).replace(/\$NAME/g, this.username);
        await execaCommand(cmd);
        this.kick();
    }
    
    async kick() {
        this.sendMsg("10.disconnect;");
        this.socket.close();
    }
}

export enum Rank {
    Unregistered = 0,
    Admin = 2,
    Moderator = 3,
    // Giving a good gap between server only internal ranks just in case
    Turn = 10,
}
