import * as Utilities from './Utilities.js';
import * as cvm from '@cvmts/cvm-rs';
import { IPData } from './IPData.js';
import IConfig from './IConfig.js';
import RateLimiter from './RateLimiter.js';
import { execa, execaCommand, ExecaSyncError } from 'execa';
import NetworkClient from './NetworkClient.js';
import { CollabVMCapabilities } from '@cvmts/collab-vm-1.2-binary-protocol';
import pino from 'pino';
import { BanManager } from './BanManager.js';

export class User {
	socket: NetworkClient;
	nopSendInterval: NodeJS.Timeout;
	msgRecieveInterval: NodeJS.Timeout;
	nopRecieveTimeout?: NodeJS.Timeout;
	username?: string;
	connectedToNode: boolean;
	viewMode: number;
	rank: Rank;
	msgsSent: number;
	Config: IConfig;
	IP: IPData;
	Capabilities: CollabVMCapabilities;
	// Hide flag. Only takes effect if the user is logged in.
	noFlag: boolean = false;
	countryCode: string | null = null;
	// Rate limiters
	ChatRateLimit: RateLimiter;
	LoginRateLimit: RateLimiter;
	RenameRateLimit: RateLimiter;
	TurnRateLimit: RateLimiter;
	VoteRateLimit: RateLimiter;

	private logger = pino({ name: 'CVMTS.User' });

	constructor(socket: NetworkClient, ip: IPData, config: IConfig, username?: string, node?: string) {
		this.IP = ip;
		this.connectedToNode = false;
		this.viewMode = -1;
		this.Config = config;
		this.socket = socket;
		this.msgsSent = 0;
		this.Capabilities = new CollabVMCapabilities();

		this.socket.on('disconnect', () => {
			// Unref the ip data for this connection
			this.IP.Unref();

			clearInterval(this.nopSendInterval);
			clearInterval(this.msgRecieveInterval);
		});

		this.socket.on('msg', (e) => {
			clearTimeout(this.nopRecieveTimeout);
			clearInterval(this.msgRecieveInterval);
			this.msgRecieveInterval = setInterval(() => this.onNoMsg(), 10000);
		});

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

	assignGuestName(existingUsers: string[]): string {
		var username;
		do {
			username = 'guest' + Utilities.Randint(10000, 99999);
		} while (existingUsers.indexOf(username) !== -1);
		this.username = username;
		return username;
	}

	sendNop() {
		this.socket.send('3.nop;');
	}

	sendMsg(msg: string) {
		if (!this.socket.isOpen()) return;
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
		this.socket.send(cvm.guacEncode('disconnect'));
		this.socket.close();
	}

	onMsgSent() {
		if (!this.Config.collabvm.automute.enabled) return;
		// rate limit guest and unregistered chat messages, but not staff ones
		switch (this.rank) {
			case Rank.Moderator:
			case Rank.Admin:
				break;

			default:
				this.ChatRateLimit.request();
				break;
		}
	}

	mute(permanent: boolean) {
		this.IP.muted = true;
		this.sendMsg(cvm.guacEncode('chat', '', `You have been muted${permanent ? '' : ` for ${this.Config.collabvm.tempMuteTime} seconds`}.`));
		if (!permanent) {
			clearTimeout(this.IP.tempMuteExpireTimeout);
			this.IP.tempMuteExpireTimeout = setTimeout(() => this.unmute(), this.Config.collabvm.tempMuteTime * 1000);
		}
	}
	unmute() {
		clearTimeout(this.IP.tempMuteExpireTimeout);
		this.IP.muted = false;
		this.sendMsg(cvm.guacEncode('chat', '', 'You are no longer muted.'));
	}

	async ban(banmgr: BanManager) {
		// Prevent the user from taking turns or chatting, in case the ban command takes a while
		this.IP.muted = true;
		await banmgr.BanUser(this.IP.address, this.username || '');
		await this.kick();
	}

	async kick() {
		this.sendMsg('10.disconnect;');
		this.socket.close();
	}
}

export enum Rank {
	Unregistered = 0,
	// After all these years
	Registered = 1,
	Admin = 2,
	Moderator = 3,
	// Giving a good gap between server only internal ranks just in case
	Turn = 10
}
