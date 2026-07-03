import IConfig from './IConfig.js';
import * as Utilities from './Utilities.js';
import { User, Rank } from './User.js';
// I hate that you have to do it like this
import CircularBuffer from 'mnemonist/circular-buffer.js';
import Queue from 'mnemonist/queue.js';
import { createHash } from 'crypto';
import { VMState, QemuVM, QemuVmDefinition } from '@computernewb/superqemu';
import { IPDataManager } from './IPData.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AuthManager from './AuthManager.js';
import { JPEGEncoder } from './JPEGEncoder.js';
import VM from './vm/interface.js';
import { ReaderModel } from '@maxmind/geoip2-node';

import { Size, Rect } from './Utilities.js';
import pino from 'pino';
import { BanManager } from './BanManager.js';
import { TheAuditLog } from './AuditLog.js';
import { IProtocolMessageHandler, ListEntry, ProtocolAddUser, ProtocolFlag, ProtocolRenameStatus, ProtocolUpgradeCapability } from './protocol/Protocol.js';
import { TheProtocolManager } from './protocol/Manager.js';
import { SpecialTurnTimes, TurnController, TurnQueue } from './TurnController.js';
import { MetaApi } from './meta/metaApi.js';
import { Vote, VoteCooldownManager } from './Vote.js';
import { VoteType } from '@cvmts/collab-vm-1.2-binary-protocol';

// Instead of strange hacks we can just use nodejs provided
// import.meta properties, which have existed since LTS if not before
const __dirname = import.meta.dirname;

const kCVMTSAssetsRoot = path.resolve(__dirname, '../../assets');

const kRestartTimeout = 5000;

type ChatHistory = {
	user: string;
	msg: string;
};

export default class CollabVMServer implements IProtocolMessageHandler {
	private Config: IConfig;

	private clients: User[];

	private ChatHistory: CircularBuffer<ChatHistory>;

	private turnController: TurnController;

	// If a reset vote is in progress
	private currentVote: Vote | null;
	private voteCooldownManager: VoteCooldownManager;

	// Completely disable turns
	private votesAllowed: boolean;

	// Hide the screen
	private screenHidden: boolean;

	// base64 image to show when the screen is hidden
	private screenHiddenImg: Buffer;
	private screenHiddenThumb: Buffer;

	private ModPerms: number;
	private VM: VM;

	// Authentication manager
	private auth: AuthManager | null;

	// Geoip
	private geoipReader: ReaderModel | null;

	// Ban manager
	private banmgr: BanManager;

	// queue of rects, reset every frame
	private rectQueue: Rect[] = [];

	// iaos
	private metaApi: MetaApi | null = null;

	private logger = pino({ name: 'CVMTS.Server' });

	constructor(config: IConfig, vm: VM, banmgr: BanManager, auth: AuthManager | null, geoipReader: ReaderModel | null, metaApi: MetaApi | null) {
		this.Config = config;
		this.ChatHistory = new CircularBuffer<ChatHistory>(Array, this.Config.collabvm.maxChatHistoryLength);
		this.turnController = new TurnController(config, this.onTurnUpdate.bind(this));
		this.clients = [];
		this.currentVote = null;
		this.voteCooldownManager = new VoteCooldownManager();
		this.votesAllowed = true;
		this.screenHidden = false;
		this.screenHiddenImg = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhidden.jpeg'));
		this.screenHiddenThumb = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhiddenthumb.jpeg'));

		this.ModPerms = Utilities.MakeModPerms(this.Config.collabvm.moderatorPermissions);

		// No size initially, since there usually won't be a display connected at all during initalization
		this.OnDisplayResized({
			width: 0,
			height: 0
		});

		this.VM = vm;

		let self = this;

		vm.Events().on('statechange', (newState: VMState) => {
			if (newState == VMState.Started) {
				self.logger.info('VM started');

				// start the display and add the events once
				if (self.VM.GetDisplay() == null) {
					self.VM.StartDisplay();

					self.logger.info('started display, adding events now');

					// add events
					self.VM.GetDisplay()?.on('resize', (size: Size) => self.OnDisplayResized(size));
					self.VM.GetDisplay()?.on('rect', (rect: Rect) => self.OnDisplayRectangle(rect));
					self.VM.GetDisplay()?.on('frame', () => self.OnDisplayFrame());
				}
			}

			if (newState == VMState.Stopped) {
				setTimeout(async () => {
					self.logger.info('restarting VM');
					await self.VM.Start();
				}, kRestartTimeout);
			}
		});

		// authentication manager
		this.auth = auth;

		this.geoipReader = geoipReader;

		this.banmgr = banmgr;

		this.metaApi = metaApi;
	}

	public connectionOpened(user: User) {
		let sameip = this.clients.filter((c) => c.IP.address === user.IP.address);
		if (sameip.length >= this.Config.collabvm.maxConnections) {
			// Kick the oldest client
			// I think this is a better solution than just rejecting the connection
			sameip[0].kick();
		}
		this.clients.push(user);

		if (this.Config.geoip.enabled) {
			try {
				user.countryCode = this.geoipReader!.country(user.IP.address).country!.isoCode;
				user.logger.info({ event: 'geoip/resolved', geoip: user.countryCode });
			} catch (error) {
				user.logger.warn({ event: 'geoip/unresolved', msg: `${error as Error}` });
			}
		}

		user.socket.on('msg', (buf: Buffer, binary: boolean) => {
			try {
				user.processMessage(this, buf, binary);
			} catch (err) {
				user.logger.error(
					{
						event: 'msg/general error',
						error_message: (err as Error).message
					},
					'Error in %s#processMessage.',
					Object.getPrototypeOf(user.protocol).constructor?.name
				);
				user.kick();
			}
		});

		user.socket.on('disconnect', () => this.connectionClosed(user));

		if (this.Config.auth.enabled) {
			user.sendAuth(this.Config.auth.apiEndpoint);
		}

		user.sendAddUser(this.getAddUser());
		if (this.Config.geoip.enabled) {
			let flags = this.getFlags();
			user.sendFlag(flags);
		}
	}

	private connectionClosed(user: User) {
		let clientIndex = this.clients.indexOf(user);
		if (clientIndex === -1) return;

		if (this.currentVote?.RemoveVote(user)) {
			this.broadcastVoteUpdate();
		}

		this.clients.splice(clientIndex, 1);

		user.logger.info({ event: 'user/disconnect' });
		if (!user.username) return;

		this.turnController.removeUser(user);
		this.clients.forEach((c) => c.sendRemUser([user.username!]));
	}

	// Protocol message handlers

	// does auth check
	private authCheck(user: User, guestPermission: boolean) {
		if (!this.Config.auth.enabled) return true;

		if (user.rank === Rank.Unregistered && !guestPermission) {
			user.sendChatMessage('', 'You need to login to do that.');
			return false;
		}

		return true;
	}

	onNop(user: User): void {
		user.onNop();
	}

	async onLogin(user: User, token: string) {
		if (!this.Config.auth.enabled) return;

		if (!user.connectedToNode) {
			user.sendLoginResponse(false, 'You must connect to the VM before logging in.');
			return;
		}

		try {
			let res = await this.auth!.Authenticate(token, user);

			if (res.clientSuccess) {
				user.logger.info({ event: 'user/auth/login', username: res.username });
				user.sendLoginResponse(true, '');

				let old = this.clients.find((c) => c.username === res.username);
				if (old) {
					// kick() doesnt wait until the user is actually removed from the list and itd be anal to make it do that
					// so we call connectionClosed manually here. When it gets called on kick(), it will return because the user isn't in the list
					this.connectionClosed(old);
					await old.kick();
				}
				// Set username
				if (user.countryCode !== null && user.noFlag) {
					// privacy
					for (let cl of this.clients.filter((c) => c !== user)) {
						cl.sendRemUser([user.username!]);
					}
					this.renameUser(user, res.username, false);
				} else this.renameUser(user, res.username, true);
				// Set rank
				user.rank = res.rank;
				if (user.rank === Rank.Admin) {
					user.sendAdminLoginResponse(true, undefined);
				} else if (user.rank === Rank.Moderator) {
					user.sendAdminLoginResponse(true, this.ModPerms);
				}
				this.clients.forEach((c) =>
					c.sendAddUser([
						{
							username: user.username!,
							rank: user.rank
						}
					])
				);
			} else {
				user.sendLoginResponse(false, res.error!);
				if (res.error === 'You are banned') {
					user.kick();
				}
			}
		} catch (err) {
			this.logger.error({ event: 'user/auth/internal error', msg: `${(err as Error).message}` });

			user.sendLoginResponse(false, 'There was an internal error while authenticating. Please let a staff member know as soon as possible');
		}
	}

	onNoFlag(user: User) {
		// Too late
		if (user.connectedToNode) return;
		user.noFlag = true;
	}

	onCapabilityUpgrade(user: User, capability: String[]): boolean {
		if (user.connectedToNode) return false;

		let enabledCaps = [];

		for (let cap of capability) {
			switch (cap) {
				// binary 1.0 (msgpack rects)
				case ProtocolUpgradeCapability.BinRects:
					enabledCaps.push(cap as ProtocolUpgradeCapability);
					user.Capabilities.bin = true;
					user.protocol = TheProtocolManager.getProtocol('binary1');
					break;
				// Install any OS
				case ProtocolUpgradeCapability.IaOS:
					if (this.Config.iaos?.enabled) {
						enabledCaps.push(cap as ProtocolUpgradeCapability);
						user.Capabilities.iaos = true;
						break;
					}
				// Extended votes
				case ProtocolUpgradeCapability.VoteX:
					enabledCaps.push(cap as ProtocolUpgradeCapability);
					user.Capabilities.votex = true;
					break;
				default:
					break;
			}
		}

		user.sendCapabilities(enabledCaps);
		return true;
	}

	onTurnRequest(user: User, forfeit: boolean): void {
		user.logger.trace({ event: 'turn/requested' });
		if (this.Config.collabvm.turnwhitelist && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;

		if (!this.authCheck(user, this.Config.auth.guestPermissions.turn)) return;

		if (!user.TurnRateLimit.request()) {
			user.logger.warn({ event: 'turn/ratelimited' });
			return;
		}
		if (!user.connectedToNode) {
			user.logger.warn({ event: 'turn/requested when not in queue' });
			return;
		}

		if (forfeit == false) {
			if (this.turnController.userInQueue(user)) return;

			// If they're muted, also ignore the turn request.
			// Send them the turn queue to prevent client glitches
			if (user.IP.muted) return;
			if (this.Config.collabvm.turnlimit.enabled) {
				// Get the amount of users in the turn queue with the same IP as the user requesting a turn.
				// If it exceeds the limit set in the config, ignore the turn request.
				let sameIp = this.turnController.usersWithSameIpInQueue(user);
				if (sameIp > this.Config.collabvm.turnlimit.maximum) {
					user.logger.warn({ event: 'turn/ignoring request due to turn limit' });
					return;
				}
			}
			user.logger.info({ event: 'turn/entering queue' });
			this.turnController.addUser(user);
		} else {
			this.turnController.removeUser(user);
		}
	}

	onStartVote(user: User, voteType: string): void {
		if ((!this.votesAllowed || this.Config.collabvm.turnwhitelist) && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;

		if (!user.connectedToNode) {
			user.logger.warn({ event: 'vote/start/not connected to node' });
			return;
		}
		if (!user.VoteRateLimit.request()) {
			user.logger.warn({ event: 'vote/start/ratelimited' });
			return;
		}

		switch (voteType) {
			case VoteType.VoteReset: {
				if (!this.Config.vote.reset?.enabled) {
					return;
				}
				this.startVote(user, VoteType.VoteReset, this.Config.vote.reset.voteTime, 'reset the VM');
				break;
			}
			case VoteType.VoteReboot: {
				if (!this.Config.vote.reboot?.enabled) {
					return;
				}
				this.startVote(user, VoteType.VoteReboot, this.Config.vote.reboot.voteTime, 'reboot the VM');
				break;
			}
			default: {
				return;
			}
		}
	}

	onCastVote(user: User, vote: boolean): void {
		if (!this.currentVote) {
			if (!user.Capabilities.votex) {
				this.onStartVote(user, VoteType.VoteReset);
			}
			return;
		}

		if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;
		if (!user.connectedToNode) {
			user.logger.warn({ event: 'vote/cast/not connected to node' });
			return;
		}

		if (!user.VoteRateLimit.request()) {
			user.logger.warn({ event: 'vote/cast/ratelimited' });
			return;
		}

		if (user.IP.hasVoted && this.currentVote.GetVote(user) === null) {
			user.logger.warn({ event: 'vote/cast/ip limit' });
			return;
		}

		if (this.currentVote.AddVote(user, vote)) {
			user.logger.info({ event: 'vote/cast', vote: vote ? 'yes' : 'no' });
			this.broadcastVoteUpdate();
			this.clients.filter((c) => !c.Capabilities.votex).forEach((c) => c.sendChatMessage('', `${user.username} has voted ${vote ? 'yes' : 'no'}.`));
		}
	}

	async onList(user: User) {
		let listEntry: ListEntry = {
			id: this.Config.collabvm.node,
			name: this.Config.collabvm.displayname,
			thumbnail: this.screenHidden ? this.screenHiddenThumb : await this.getThumbnail()
		};

		if (this.VM.GetState() == VMState.Started) {
			user.sendListResponse([listEntry]);
		}
	}

	private async connectViewShared(user: User, node: string, viewMode: number | undefined) {
		if (!user.username || node !== this.Config.collabvm.node) {
			user.sendConnectFailResponse();
			return;
		}

		user.connectedToNode = true;

		if (viewMode !== undefined) {
			if (viewMode !== 0 && viewMode !== 1) {
				user.sendConnectFailResponse();
				return;
			}

			user.viewMode = viewMode;
		}

		user.sendConnectOKResponse(this.Config.vote.reset.enabled);

		if (user.Capabilities.votex) {
			let votesEnabled = [];

			if (this.Config.vote.reset?.enabled) votesEnabled.push(VoteType.VoteReset);
			if (this.Config.vote.reboot?.enabled) votesEnabled.push(VoteType.VoteReboot);

			user.sendVotesEnabled(votesEnabled);
		}

		if (this.ChatHistory.size !== 0) {
			let history = this.ChatHistory.toArray() as ChatHistory[];
			user.sendChatHistoryMessage(history);
		}
		if (this.Config.collabvm.motd) user.sendChatMessage('', this.Config.collabvm.motd);
		if (this.screenHidden) {
			user?.sendScreenResize(1024, 768);
			user?.sendScreenUpdate({
				x: 0,
				y: 0,
				data: this.screenHiddenImg
			});
		} else {
			await this.SendFullScreenWithSize(user);
		}

		user.sendSync(Date.now());

		if (this.currentVote) this.sendVoteUpdate(user);
		this.sendTurnUpdate(this.turnController.getTurnInfo(), user);

		if (this.Config?.iaos.enabled) {
			user.sendIaosAdvertisement(this.Config.meta.publicApi, this.Config.iaos.mediaKindSupported);
		}
	}

	async onConnect(user: User, node: string) {
		user.logger.info({ event: 'user/joined node', node });
		return this.connectViewShared(user, node, undefined);
	}

	async onView(user: User, node: string, viewMode: number) {
		user.logger.info({ event: 'user/entering view', node, viewMode });
		return this.connectViewShared(user, node, viewMode);
	}

	onRename(user: User, newName: string | undefined): void {
		if (!user.RenameRateLimit.request()) {
			user.logger.warn({ event: 'rename/ratelimit' });
			return;
		}
		if (user.connectedToNode && user.IP.muted) {
			user.logger.warn({ event: 'rename/attempted to rename while muted' });
			return;
		}
		if (this.Config.auth.enabled && user.rank !== Rank.Unregistered) {
			user.sendChatMessage('', 'Go to your account settings to change your username.');
			return;
		}
		if (this.Config.auth.enabled && newName !== undefined) {
			// Don't send system message to a user without a username since it was likely an automated attempt by the webapp
			if (user.username) user.sendChatMessage('', 'You need to login to do that.');
			if (user.rank !== Rank.Unregistered) return;
			this.renameUser(user, undefined);
			return;
		}
		this.renameUser(user, newName);
	}

	onChat(user: User, message: string): void {
		if (!user.username) {
			user.logger.warn({ event: 'chat/dropped message without username', message });
			return;
		}
		if (user.IP.muted) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.chat)) return;

		var msg = Utilities.HTMLSanitize(message);
		// One of the things I hated most about the old server is it completely discarded your message if it was too long
		if (msg.length > this.Config.collabvm.maxChatLength) msg = msg.substring(0, this.Config.collabvm.maxChatLength);
		if (msg.trim().length < 1) return;

		user.logger.info({ event: 'chat/message', msg });
		this.clients.forEach((c) => c.sendChatMessage(user.username!, msg));
		this.ChatHistory.push({ user: user.username, msg: msg });
		user.onChatMsgSent();
	}

	onKey(user: User, keysym: number, pressed: boolean): void {
		if (!this.turnController.userIsActive(user) && user.rank !== Rank.Admin) return;
		user.logger.info({ event: 'key', keysym, pressed });
		this.VM.GetDisplay()?.KeyboardEvent(keysym, pressed);
	}

	onMouse(user: User, x: number, y: number, buttonMask: number): void {
		if (!this.turnController.userIsActive(user) && user.rank !== Rank.Admin) return;
		this.VM.GetDisplay()?.MouseEvent(x, y, buttonMask);
	}

	async onAdminLogin(user: User, password: string) {
		if (!user.LoginRateLimit.request() || !user.username) return;
		var sha256 = createHash('sha256');
		sha256.update(password, 'utf-8');
		var pwdHash = sha256.digest('hex');
		sha256.destroy();

		if (this.Config.collabvm.turnwhitelist && pwdHash === this.Config.collabvm.turnpass) {
			user.logger.info({ event: 'admin/granted turnpass' });
			user.turnWhitelist = true;
			user.sendChatMessage('', 'You may now take turns.');
			return;
		}

		if (this.Config.auth.enabled) {
			user.sendChatMessage('', 'This server does not support staff passwords. Please log in to become staff.');
			return;
		}

		if (pwdHash === this.Config.collabvm.adminpass) {
			user.logger.info({ event: 'admin/granted adminpass' });
			user.rank = Rank.Admin;
			user.sendAdminLoginResponse(true, undefined);
		} else if (this.Config.collabvm.moderatorEnabled && pwdHash === this.Config.collabvm.modpass) {
			user.logger.info({ event: 'admin/granted modpass' });
			user.rank = Rank.Moderator;
			user.sendAdminLoginResponse(true, this.ModPerms);
		} else {
			user.logger.warn({ event: 'admin/failed login attempt' });
			user.sendAdminLoginResponse(false, undefined);
			return;
		}

		if (this.screenHidden) {
			await this.SendFullScreenWithSize(user);
		}

		// Update rank
		this.clients.forEach((c) =>
			c.sendAddUser([
				{
					username: user.username!,
					rank: user.rank
				}
			])
		);
	}

	async onAdminMonitor(user: User, node: string, command: string) {
		if (user.rank !== Rank.Admin) return;
		if (node !== this.Config.collabvm.node) return;
		TheAuditLog.onMonitorCommand(user, command);
		let output = await this.VM.MonitorCommand(command);
		user.sendAdminMonitorResponse(String(output));
	}

	onAdminRestore(user: User, node: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.restore)) return;
		TheAuditLog.onReset(user);
		this.VM.Reset();
	}

	async onAdminReboot(user: User, node: string) {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.reboot)) return;
		if (node !== this.Config.collabvm.node) return;
		TheAuditLog.onReboot(user);
		await this.VM.Reboot();
	}

	async onAdminBanUser(user: User, username: string) {
		// Ban
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.ban)) return;
		let target = this.clients.find((c) => c.username === username);
		if (!target) return;
		TheAuditLog.onBan(user, target);
		await target.ban(this.banmgr);
	}

	onAdminForceVote(user: User, choice: number): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.forcevote)) return;
		if (!this.currentVote) return;
		this.currentVote.EndVote(choice == 1);
	}

	onAdminMuteUser(user: User, username: string, temporary: boolean): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.mute)) return;

		let target = this.clients.find((c) => c.username === username);
		if (!target) return;
		target.mute(!temporary);
	}

	onAdminKickUser(user: User, username: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.kick)) return;
		var target = this.clients.find((c) => c.username === username);
		if (!target) return;
		TheAuditLog.onKick(user, target);
		target.kick();
	}

	onAdminEndTurn(user: User, username: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;

		var target = this.clients.find((c) => c.username === username);
		if (!target) return;
		this.endTurn(target);
	}

	onAdminClearQueue(user: User, node: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
		if (node !== this.Config.collabvm.node) return;
		this.clearTurns();
	}

	onAdminRename(user: User, target: string, newName: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.rename)) return;
		if (this.Config.auth.enabled) {
			user.sendChatMessage('', 'Cannot rename users on a server that uses authentication.');
		}
		var targetUser = this.clients.find((c) => c.username === target);
		if (!targetUser) return;
		this.renameUser(targetUser, newName);
	}

	onAdminGetIP(user: User, username: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.grabip)) return;
		let target = this.clients.find((c) => c.username === username);
		if (!target) return;
		user.sendAdminIPResponse(username, target.IP.address);
	}

	onAdminBypassTurn(user: User): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
		this.bypassTurn(user);
	}

	onAdminRawMessage(user: User, message: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.xss)) return;
		switch (user.rank) {
			case Rank.Admin:
				this.clients.forEach((c) => c.sendChatMessage(user.username!, message));

				this.ChatHistory.push({ user: user.username!, msg: message });
				break;
			case Rank.Moderator:
				this.clients.filter((c) => c.rank !== Rank.Admin).forEach((c) => c.sendChatMessage(user.username!, message));

				this.clients.filter((c) => c.rank === Rank.Admin).forEach((c) => c.sendChatMessage(user.username!, Utilities.HTMLSanitize(message)));
				break;
		}
	}

	onAdminToggleTurns(user: User, enabled: boolean): void {
		if (user.rank !== Rank.Admin) return;
		this.votesAllowed = enabled;
		if (enabled) {
			this.turnController.unpauseQueue();
		} else {
			this.turnController.pauseQueue();
		}
	}

	onAdminIndefiniteTurn(user: User): void {
		if (user.rank !== Rank.Admin) return;
		this.turnController.pauseQueue();
		this.turnController.bypassTurn(user);
	}

	async onAdminHideScreen(user: User, show: boolean) {
		if (user.rank !== Rank.Admin) return;
		if (show) {
			// if(!this.screenHidden) return; ?

			this.screenHidden = false;
			let displaySize = this.VM.GetDisplay()?.Size();

			if (displaySize == undefined) return;

			let encoded = await this.MakeRectData({
				x: 0,
				y: 0,
				width: displaySize.width,
				height: displaySize.height
			});

			this.clients.forEach(async (client) => this.SendFullScreenWithSize(client));
		} else {
			this.screenHidden = true;
			this.clients
				.filter((c) => c.rank == Rank.Unregistered)
				.forEach((client) => {
					client.sendScreenResize(1024, 768);
					client.sendScreenUpdate({
						x: 0,
						y: 0,
						data: this.screenHiddenImg
					});
				});
		}
	}

	onAdminSystemMessage(user: User, message: string): void {
		if (user.rank !== Rank.Admin) return;
		this.clients.forEach((c) => c.sendChatMessage('', message));
	}

	// iaos handlers

	async onIaosChangeMedia(user: User, id: string): Promise<void> {
		if (!this.Config.iaos?.enabled || !this.metaApi) {
			return;
		}

		if (this.Config.collabvm.turnwhitelist && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.iaos)) return;
		if (!user.connectedToNode) {
			user.logger.warn({ event: 'iaos/insert/not connected to node' });
			return;
		}

		let entry = await this.metaApi.iaosGetMediaById(id);

		if (!entry) {
			user.logger.info({ event: 'iaos/insert/bad_id', mediaId: id });
			return;
		}

		if (this.Config.iaos.mediaKindSupported.indexOf(entry.kind) === -1) {
			user.logger.info({ event: 'iaos/insert/kind_unsupported', mediaId: id, mediaKind: entry.kind });
			return;
		}

		if (this.Config.vote.iaosInsert?.enabled && user.rank !== Rank.Admin && user.rank !== Rank.Moderator) {
			if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;

			this.startVote(user, VoteType.VoteIaosInsertMedia, this.Config.vote.iaosInsert.voteTime, `insert ${entry.name}`, {
				mediaId: entry.id,
				mediaKind: entry.kind,
				mediaName: entry.name
			});
		} else {
			await this.VM.InsertMedia(entry.kind, entry.path);
			this.clients.forEach((c) => c.sendIaosMediaChanged(user, entry.kind, false, entry.name));
			user.logger.info({ event: 'iaos/insert', mediaKind: entry.kind, mediaId: id, mediaPath: entry.path });
		}
	}

	async onIaosEjectMedia(user: User, kind: string): Promise<void> {
		if (!this.Config.iaos.enabled) {
			return;
		}

		if (this.Config.collabvm.turnwhitelist && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.iaos)) return;
		if (!user.connectedToNode) {
			user.logger.warn({ event: 'iaos/eject/not connected to node' });
			return;
		}

		if (this.Config.iaos.mediaKindSupported.indexOf(kind) === -1) {
			user.logger.info({ event: 'iaos/eject/kind_unsupported', mediaKind: kind });
		}

		if (this.Config.vote.iaosEject?.enabled && user.rank !== Rank.Admin && user.rank !== Rank.Moderator) {
			if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;

			this.startVote(user, VoteType.VoteIaosEjectMedia, this.Config.vote.iaosEject.voteTime, 'eject media from the VM', {
				mediaKind: kind
			});
		} else {
			await this.VM.EjectMedia(kind);
			this.clients.forEach((c) => c.sendIaosMediaChanged(user, kind, true));
			user.logger.info({ event: 'iaos/eject', mediaKind: kind });
		}
	}

	// end protocol message handlers

	getUsernameList(): string[] {
		var arr: string[] = [];
		this.clients.filter((c) => c.username).forEach((c) => arr.push(c.username!));
		return arr;
	}

	renameUser(client: User, newName?: string, announce: boolean = true) {
		// This shouldn't need a ternary but it does for some reason
		let hadName = client.username ? true : false;
		let oldname: any;
		if (hadName) oldname = client.username;

		let status = ProtocolRenameStatus.Ok;

		if (!newName) {
			client.assignGuestName(this.getUsernameList());
		} else {
			newName = newName.trim();
			if (hadName && newName === oldname) {
				client.sendSelfRename(ProtocolRenameStatus.Ok, client.username!, client.rank);
				return;
			}

			if (this.getUsernameList().indexOf(newName) !== -1) {
				client.assignGuestName(this.getUsernameList());
				if (client.connectedToNode) {
					status = ProtocolRenameStatus.UsernameTaken;
				}
			} else if (!/^[a-zA-Z0-9\ \-\_\.]+$/.test(newName) || newName.length > 20 || newName.length < 3) {
				client.assignGuestName(this.getUsernameList());
				status = ProtocolRenameStatus.UsernameInvalid;
			} else if (this.Config.collabvm.usernameblacklist.indexOf(newName) !== -1) {
				client.assignGuestName(this.getUsernameList());
				status = ProtocolRenameStatus.UsernameNotAllowed;
			} else client.username = newName;
		}

		client.sendSelfRename(status, client.username!, client.rank);

		if (hadName) {
			client.logger.info({ event: 'rename', from: oldname, to: client.username });
			if (announce) this.clients.forEach((c) => c.sendRename(oldname, client.username!, client.rank));
		} else {
			client.logger.info({ event: 'rename', to: client.username });
			if (announce)
				this.clients.forEach((c) => {
					c.sendAddUser([
						{
							username: client.username!,
							rank: client.rank
						}
					]);

					if (client.countryCode !== null) {
						c.sendFlag([
							{
								username: client.username!,
								countryCode: client.countryCode
							}
						]);
					}
				});
		}
	}

	private getAddUser(): ProtocolAddUser[] {
		return this.clients
			.filter((c) => c.username)
			.map((c) => {
				return {
					username: c.username!,
					rank: c.rank
				};
			});
	}

	private getFlags(): ProtocolFlag[] {
		let arr = [];
		for (let c of this.clients.filter((cl) => cl.countryCode !== null && cl.username && (!cl.noFlag || cl.rank === Rank.Unregistered))) {
			arr.push({
				username: c.username!,
				countryCode: c.countryCode!
			});
		}
		return arr;
	}

	private sendTurnUpdate(state: TurnQueue, client: User) {
		if (state.length == 0) {
			// kinda not happy about this because it's a bit leaky, but it's better than before I suppose
			if (this.turnController.paused()) client.sendTurnQueue(SpecialTurnTimes.Paused, []);
			else client.sendTurnQueue(0, []);
			return;
		}

		let users = state.map((v) => v.user.username);
		if (this.turnController.userInQueue(client)) {
			let entry =
				state[
					state.findIndex((v) => {
						if (v.user == null) return false;
						return v.user.username === client.username;
					})
				];

			if (entry.waiting) {
				client.sendTurnQueueWaiting(state[0].time, users, state[0].time + entry.waitingTime!);
			} else {
				client.sendTurnQueue(state[0].time, users);
			}
		} else {
			client.sendTurnQueue(state[0].time, users);
		}
	}

	private onTurnUpdate(state: TurnQueue) {
		// broadcast new turn state
		this.clients
			.filter((c) => c.connectedToNode)
			.forEach((c) => {
				this.sendTurnUpdate(state, c);
			});
	}

	clearTurns() {
		this.logger.info({ event: 'turn/clearing turn queue' });
		this.turnController.clearTurns();
	}

	bypassTurn(client: User) {
		client.logger.info({ event: 'turn/bypassing' });
		this.turnController.bypassTurn(client);
	}

	endTurn(client: User) {
		client.logger.info({ event: 'turn/ending' });
		this.turnController.removeUser(client);
	}

	private OnDisplayRectangle(rect: Rect) {
		this.rectQueue.push(rect);
	}

	private OnDisplayResized(size: Size) {
		this.clients
			.filter((c) => c.connectedToNode || c.viewMode == 1)
			.forEach((c) => {
				if (this.screenHidden && c.rank == Rank.Unregistered) return;
				c.sendScreenResize(size.width, size.height);
			});
	}

	private async OnDisplayFrame() {
		let self = this;

		let doRect = async (rect: Rect) => {
			let encoded = await this.MakeRectData(rect);

			self.clients
				.filter((c) => c.connectedToNode || c.viewMode == 1)
				.forEach((c) => {
					if (self.screenHidden && c.rank == Rank.Unregistered) return;

					c.sendScreenUpdate({
						x: rect.x,
						y: rect.y,
						data: encoded
					});
				});
		};

		let promises: Promise<void>[] = [];

		for (let rect of self.rectQueue) promises.push(doRect(rect));

		// javascript is a very solidly designed language with no holes
		// or usability traps inside of it whatsoever
		this.rectQueue.length = 0;

		await Promise.all(promises);
	}

	private async SendFullScreenWithSize(client: User) {
		let display = this.VM.GetDisplay();
		if (display == null) return;

		let displaySize = display.Size();

		let encoded = await this.MakeRectData({
			x: 0,
			y: 0,
			width: displaySize.width,
			height: displaySize.height
		});

		client.sendScreenResize(displaySize.width, displaySize.height);

		client.sendScreenUpdate({
			x: 0,
			y: 0,
			data: encoded
		});
	}

	private async MakeRectData(rect: Rect) {
		let display = this.VM.GetDisplay();

		// TODO: actually throw an error here
		if (display == null) return Buffer.from('no');

		let displaySize = display.Size();
		let encoded = await JPEGEncoder.Encode(display.Buffer(), displaySize, rect);

		return encoded;
	}

	async getThumbnail(): Promise<Buffer> {
		let display = this.VM.GetDisplay();

		// oh well
		if (!display?.Connected()) return Buffer.alloc(4);

		return JPEGEncoder.EncodeThumbnail(display.Buffer(), display.Size());
	}

	startVote(user: User, voteType: VoteType, voteTime: number, intentStr: string, data?: any) {
		if (this.currentVote) {
			user.sendVoteStartFailed(voteType, 'existingVote');
			return;
		}

		let cooldownTime = this.voteCooldownManager.CheckCooldown(voteType as VoteType);
		if (cooldownTime !== null) {
			user.sendVoteStartFailed(voteType, 'cooldown', cooldownTime);
			return;
		}

		this.currentVote = new Vote(voteType, voteTime, intentStr, user, data);
		this.currentVote.on('voteEnd', (result) => this.onVoteEnd(result));
		user.logger.info({ event: 'vote/start', voteType });
		this.clients.forEach((c) =>
			c.sendVoteStats(
				true,
				this.currentVote!.GetStartedBy(),
				this.currentVote!.GetVoteType(),
				this.currentVote!.GetVoteIntentStr(),
				this.currentVote!.GetVoteTime(),
				[this.currentVote!.GetStartedBy()],
				[],
				this.currentVote!.data
			)
		);
	}

	async onVoteEnd(result: boolean) {
		if (!this.currentVote) return;

		switch (this.currentVote.GetVoteType()) {
			case VoteType.VoteReset: {
				if (result === true) {
					this.VM.Reset();
				}
				this.voteCooldownManager.SetCooldown(VoteType.VoteReset, this.Config.vote.reset.voteCooldown);
				break;
			}
			case VoteType.VoteReboot: {
				if (result === true) {
					this.VM.Reboot();
				}
				this.voteCooldownManager.SetCooldown(VoteType.VoteReboot, this.Config.vote.reboot.voteCooldown);
				break;
			}
			case VoteType.VoteIaosInsertMedia: {
				if (result === true) {
					let mediaId = this.currentVote.data.mediaId as string;

					let entry = await this.metaApi!.iaosGetMediaById(mediaId);

					if (!entry) {
						this.logger.info({ event: 'iaos/insert/bad_id', mediaId });
						return;
					}

					await this.VM.InsertMedia(entry.kind, entry.path);
					this.logger.info({ event: 'iaos/insert', mediaKind: entry.kind, mediaId, mediaPath: entry.path });
				}

				this.voteCooldownManager.SetCooldown(VoteType.VoteIaosInsertMedia, this.Config.vote.iaosInsert.voteCooldown);
				break;
			}
			case VoteType.VoteIaosEjectMedia: {
				if (result === true) {
					let mediaKind = this.currentVote.data.mediaKind as string;
					await this.VM.EjectMedia(mediaKind);
					this.logger.info({ event: 'iaos/eject', mediaKind });
				}

				this.voteCooldownManager.SetCooldown(VoteType.VoteIaosEjectMedia, this.Config.vote.iaosEject.voteCooldown);
				break;
			}
		}

		this.clients.forEach((c) => c.sendVoteEnded(this.currentVote!.GetVoteType(), this.currentVote!.GetVoteIntentStr(), result));
		this.currentVote = null;
	}

	broadcastVoteUpdate() {
		if (!this.currentVote) return;

		this.clients.forEach((c) => this.sendVoteUpdate(c));
	}

	sendVoteUpdate(client: User) {
		if (!this.currentVote) return;

		client.sendVoteStats(
			false,
			this.currentVote.GetStartedBy(),
			this.currentVote.GetVoteType(),
			this.currentVote.GetVoteIntentStr(),
			this.currentVote.GetVoteTime(),
			this.currentVote.GetYesVotes(),
			this.currentVote.GetNoVotes(),
			this.currentVote.data
		);
	}
}
