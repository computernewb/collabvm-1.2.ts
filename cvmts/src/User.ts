import * as Utilities from './Utilities.js';
import * as cvm from '@cvmts/cvm-rs';
import { IPData } from './IPData.js';
import IConfig from './IConfig.js';
import RateLimiter from './RateLimiter.js';
import { NetworkClient } from './net/NetworkClient.js';
import { CollabVMCapabilities } from '@cvmts/collab-vm-1.2-binary-protocol';
import pino from 'pino';
import { BanManager } from './BanManager.js';
import { IProtocol, IProtocolMessageHandler, ListEntry, ProtocolAddUser, ProtocolChatHistory, ProtocolFlag, ProtocolRenameStatus, ProtocolUpgradeCapability, ScreenRect } from './protocol/Protocol.js';
import { TheProtocolManager } from './protocol/Manager.js';
import { CollabVMNode } from './CollabVMNode.js';

export class User {
	socket: NetworkClient;
	nopSendInterval: NodeJS.Timeout;
	msgRecieveInterval: NodeJS.Timeout;
	nopRecieveTimeout?: NodeJS.Timeout;
	username?: string;
	public Node: CollabVMNode | null;
	viewMode: number;
	rank: Rank;
	msgsSent: number;
	Config: IConfig;
	IP: IPData;

	Capabilities: CollabVMCapabilities;

	// This contains all capabilities which the user has negotiated 
	// (and we have support for).
	negotiatedCapabilities: Set<ProtocolUpgradeCapability> = new Set<ProtocolUpgradeCapability>();

	protocol: IProtocol;
	turnWhitelist: boolean = false;
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

	constructor(socket: NetworkClient, protocol: string, ip: IPData, config: IConfig, username?: string) {
		this.IP = ip;
		this.Node = null;
		this.viewMode = -1;
		this.Config = config;
		this.socket = socket;
		this.msgsSent = 0;
		this.Capabilities = new CollabVMCapabilities();

		// All clients default to the Guacamole protocol.
		this.protocol = TheProtocolManager.getProtocol(protocol);

		this.socket.on('disconnect', () => {
			// Unref the ip data for this connection
			this.IP.Unref();

			clearInterval(this.nopSendInterval);
			clearInterval(this.msgRecieveInterval);
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

	get connectedToNode() {
		// Compatibility hack
		return this.Node != null;
	}

	get shouldRecieveScreenUpdates() {
		// Screen updates should only be sent in the following cases:
		// - The user connected via `connect` op
		// - The user connected via `view` op, but set viewmode 1
		return this.viewMode == -1 || this.viewMode == 1;
	}

	hasCapability(cap: ProtocolUpgradeCapability) {
		return this.negotiatedCapabilities.has(cap);
	}

	assignGuestName(existingUsers: string[]): string {
		var username;
		do {
			username = 'guest' + Utilities.Randint(10000, 99999);
		} while (existingUsers.indexOf(username) !== -1);
		this.username = username;
		return username;
	}

	onNop() {
		clearTimeout(this.nopRecieveTimeout);
		clearInterval(this.msgRecieveInterval);
		this.msgRecieveInterval = setInterval(() => this.onNoMsg(), 10000);
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

	onChatMsgSent() {
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

	// These wrap the currently set IProtocol instance to feed state to them.
	// This is probably grody, but /shrug. It works, and feels less awful than
	// manually wrapping state (and probably prevents mixup bugs too.)

	processMessage(handler: IProtocolMessageHandler, buffer: Buffer) {
		this.protocol.processMessage(this, handler, buffer);
	}

	sendNop(): void {
		this.protocol.sendNop(this);
	}

	sendSync(now: number): void {
		this.protocol.sendSync(this, now);
	}

	sendAuth(authServer: string): void {
		this.protocol.sendAuth(this, authServer);
	}

	sendCapabilities(caps: ProtocolUpgradeCapability[]): void {
		this.protocol.sendCapabilities(this, caps);
	}

	sendConnectFailResponse(): void {
		this.protocol.sendConnectFailResponse(this);
	}

	sendConnectOKResponse(votes: boolean): void {
		this.protocol.sendConnectOKResponse(this, votes);
	}

	sendLoginResponse(ok: boolean, message: string | undefined): void {
		this.protocol.sendLoginResponse(this, ok, message);
	}

	sendAdminLoginResponse(ok: boolean, modPerms: number | undefined): void {
		this.protocol.sendAdminLoginResponse(this, ok, modPerms);
	}

	sendAdminMonitorResponse(output: string): void {
		this.protocol.sendAdminMonitorResponse(this, output);
	}

	sendAdminIPResponse(username: string, ip: string): void {
		this.protocol.sendAdminIPResponse(this, username, ip);
	}

	sendChatMessage(username: '' | string, message: string): void {
		this.protocol.sendChatMessage(this, username, message);
	}

	sendChatHistoryMessage(history: ProtocolChatHistory[]): void {
		this.protocol.sendChatHistoryMessage(this, history);
	}

	sendAddUser(users: ProtocolAddUser[]): void {
		this.protocol.sendAddUser(this, users);
	}

	sendRemUser(users: string[]): void {
		this.protocol.sendRemUser(this, users);
	}

	sendFlag(flag: ProtocolFlag[]): void {
		this.protocol.sendFlag(this, flag);
	}

	sendSelfRename(status: ProtocolRenameStatus, newUsername: string, rank: Rank): void {
		this.protocol.sendSelfRename(this, status, newUsername, rank);
	}

	sendRename(oldUsername: string, newUsername: string, rank: Rank): void {
		this.protocol.sendRename(this, oldUsername, newUsername, rank);
	}

	sendListResponse(list: ListEntry[]): void {
		this.protocol.sendListResponse(this, list);
	}

	sendTurnQueue(turnTime: number, users: string[]): void {
		this.protocol.sendTurnQueue(this, turnTime, users);
	}

	sendTurnQueueWaiting(turnTime: number, users: string[], waitTime: number): void {
		this.protocol.sendTurnQueueWaiting(this, turnTime, users, waitTime);
	}

	sendVoteStarted(): void {
		this.protocol.sendVoteStarted(this);
	}

	sendVoteStats(msLeft: number, nrYes: number, nrNo: number): void {
		this.protocol.sendVoteStats(this, msLeft, nrYes, nrNo);
	}

	sendVoteEnded(): void {
		this.protocol.sendVoteEnded(this);
	}

	sendVoteCooldown(ms: number): void {
		this.protocol.sendVoteCooldown(this, ms);
	}

	sendScreenResize(width: number, height: number): void {
		this.protocol.sendScreenResize(this, width, height);
	}

	sendScreenUpdate(rect: ScreenRect): void {
		this.protocol.sendScreenUpdate(this, rect);
	}
}

export enum Rank {
	Unregistered = 0,
	// After all these years
	Registered = 1,
	Admin = 2,
	Moderator = 3
}
