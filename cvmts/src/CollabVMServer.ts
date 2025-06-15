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

// Instead of strange hacks we can just use nodejs provided
// import.meta properties, which have existed since LTS if not before
const __dirname = import.meta.dirname;

const kCVMTSAssetsRoot = path.resolve(__dirname, '../../assets');

const kRestartTimeout = 5000;

type ChatHistory = {
	user: string;
	msg: string;
};

type VoteTally = {
	yes: number;
	no: number;
};

export default class CollabVMServer implements IProtocolMessageHandler {
	private Config: IConfig;

	private clients: User[];

	private ChatHistory: CircularBuffer<ChatHistory>;

	private TurnQueue: Queue<User>;

	// Time remaining on the current turn
	private TurnTime: number;

	// Interval to keep track of the current turn time
	private TurnInterval?: NodeJS.Timeout;

	// If a reset vote is in progress
	private voteInProgress: boolean;

	// Interval to keep track of vote resets
	private voteInterval?: NodeJS.Timeout;

	// How much time is left on the vote
	private voteTime: number;

	// How much time until another reset vote can be cast
	private voteCooldown: number;

	// Interval to keep track
	private voteCooldownInterval?: NodeJS.Timeout;

	// Completely disable turns
	private turnsAllowed: boolean;

	// Hide the screen
	private screenHidden: boolean;

	// base64 image to show when the screen is hidden
	private screenHiddenImg: Buffer;
	private screenHiddenThumb: Buffer;

	// Indefinite turn
	private indefiniteTurn: User | null;
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

	private logger = pino({ name: 'CVMTS.Server' });

	constructor(config: IConfig, vm: VM, banmgr: BanManager, auth: AuthManager | null, geoipReader: ReaderModel | null) {
		this.Config = config;
		this.ChatHistory = new CircularBuffer<ChatHistory>(Array, this.Config.collabvm.maxChatHistoryLength);
		this.TurnQueue = new Queue<User>();
		this.TurnTime = 0;
		this.clients = [];
		this.voteInProgress = false;
		this.voteTime = 0;
		this.voteCooldown = 0;
		this.turnsAllowed = true;
		this.screenHidden = false;
		this.screenHiddenImg = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhidden.jpeg'));
		this.screenHiddenThumb = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhiddenthumb.jpeg'));

		this.indefiniteTurn = null;
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
			} catch (error) {
				this.logger.warn(`Failed to get country code for ${user.IP.address}: ${(error as Error).message}`);
			}
		}

		user.socket.on('msg', (buf: Buffer, binary: boolean) => {
			try {
				user.processMessage(this, buf);
			} catch (err) {
				this.logger.error({
					ip: user.IP.address,
					username: user.username,
					error_message: (err as Error).message
				}, 'Error in %s#processMessage.', Object.getPrototypeOf(user.protocol).constructor?.name);
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

		if (user.IP.vote != null) {
			user.IP.vote = null;
			this.sendVoteUpdate();
		}

		if (this.indefiniteTurn === user) this.indefiniteTurn = null;

		this.clients.splice(clientIndex, 1);

		this.logger.info(`Disconnect From ${user.IP.address}${user.username ? ` with username ${user.username}` : ''}`);
		if (!user.username) return;
		if (this.TurnQueue.toArray().indexOf(user) !== -1) {
			var hadturn = this.TurnQueue.peek() === user;
			this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter((u) => u !== user));
			if (hadturn) this.nextTurn();
		}

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
				this.logger.info(`${user.IP.address} logged in as ${res.username}`);
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
			this.logger.error(`Error authenticating client ${user.IP.address}: ${(err as Error).message}`);

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
				default:
					break;
			}
		}

		user.sendCapabilities(enabledCaps);
		return true;
	}

	onTurnRequest(user: User, forfeit: boolean): void {
		if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;

		if (!this.authCheck(user, this.Config.auth.guestPermissions.turn)) return;

		if (!user.TurnRateLimit.request()) return;
		if (!user.connectedToNode) return;

		if (forfeit == false) {
			var currentQueue = this.TurnQueue.toArray();
			// If the user is already in the turn queue, ignore the turn request.
			if (currentQueue.indexOf(user) !== -1) return;
			// If they're muted, also ignore the turn request.
			// Send them the turn queue to prevent client glitches
			if (user.IP.muted) return;
			if (this.Config.collabvm.turnlimit.enabled) {
				// Get the amount of users in the turn queue with the same IP as the user requesting a turn.
				let turns = currentQueue.filter((otheruser) => otheruser.IP.address == user.IP.address);
				// If it exceeds the limit set in the config, ignore the turn request.
				if (turns.length + 1 > this.Config.collabvm.turnlimit.maximum) return;
			}
			this.TurnQueue.enqueue(user);
			if (this.TurnQueue.size === 1) this.nextTurn();
		} else {
			// Not sure why this wasn't using this before
			this.endTurn(user);
		}
		this.sendTurnUpdate();
	}

	onVote(user: User, choice: number): void {
		if (!this.VM.SnapshotsSupported()) return;
		if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
		if (!user.connectedToNode) return;
		if (!user.VoteRateLimit.request()) return;
		switch (choice) {
			case 1:
				if (!this.voteInProgress) {
					if (!this.authCheck(user, this.Config.auth.guestPermissions.callForReset)) return;

					if (this.voteCooldown !== 0) {
						user.sendVoteCooldown(this.voteCooldown);
						return;
					}

					this.startVote();
					this.clients.forEach((c) => c.sendChatMessage('', `${user.username} has started a vote to reset the VM.`));
				}

				if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;

				if (user.IP.vote !== true) {
					this.clients.forEach((c) => c.sendChatMessage('', `${user.username} has voted yes.`));
				}
				user.IP.vote = true;
				break;
			case 0:
				if (!this.voteInProgress) return;

				if (!this.authCheck(user, this.Config.auth.guestPermissions.vote)) return;

				if (user.IP.vote !== false) {
					this.clients.forEach((c) => c.sendChatMessage('', `${user.username} has voted no.`));
				}
				user.IP.vote = false;
				break;
			default:
				break;
		}
		this.sendVoteUpdate();
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

		user.sendConnectOKResponse(this.VM.SnapshotsSupported());

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

		if (this.voteInProgress) this.sendVoteUpdate(user);
		this.sendTurnUpdate(user);
	}

	async onConnect(user: User, node: string) {
		return this.connectViewShared(user, node, undefined);
	}

	async onView(user: User, node: string, viewMode: number) {
		return this.connectViewShared(user, node, viewMode);
	}

	onRename(user: User, newName: string | undefined): void {
		if (!user.RenameRateLimit.request()) return;
		if (user.connectedToNode && user.IP.muted) return;
		if (this.Config.auth.enabled && user.rank !== Rank.Unregistered) {
			user.sendChatMessage('', 'Go to your account settings to change your username.');
			return;
		}
		if (this.Config.auth.enabled && newName !== undefined) {
			// Don't send system message to a user without a username since it was likely an automated attempt by the webapp
			if (user.username) user.sendChatMessage('', 'You need to log in to do that.');
			if (user.rank !== Rank.Unregistered) return;
			this.renameUser(user, undefined);
			return;
		}
		this.renameUser(user, newName);
	}

	onChat(user: User, message: string): void {
		if (!user.username) return;
		if (user.IP.muted) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.chat)) return;

		var msg = Utilities.HTMLSanitize(message);
		// One of the things I hated most about the old server is it completely discarded your message if it was too long
		if (msg.length > this.Config.collabvm.maxChatLength) msg = msg.substring(0, this.Config.collabvm.maxChatLength);
		if (msg.trim().length < 1) return;

		this.clients.forEach((c) => c.sendChatMessage(user.username!, msg));
		this.ChatHistory.push({ user: user.username, msg: msg });
		user.onChatMsgSent();
	}

	onKey(user: User, keysym: number, pressed: boolean): void {
		if (this.TurnQueue.peek() !== user && user.rank !== Rank.Admin) return;
		this.VM.GetDisplay()?.KeyboardEvent(keysym, pressed);
	}

	onMouse(user: User, x: number, y: number, buttonMask: number): void {
		if (this.TurnQueue.peek() !== user && user.rank !== Rank.Admin) return;
		this.VM.GetDisplay()?.MouseEvent(x, y, buttonMask);
	}

	async onAdminLogin(user: User, password: string) {
		if (!user.LoginRateLimit.request() || !user.username) return;
		var sha256 = createHash('sha256');
		sha256.update(password, 'utf-8');
		var pwdHash = sha256.digest('hex');
		sha256.destroy();

		if (this.Config.collabvm.turnwhitelist && pwdHash === this.Config.collabvm.turnpass) {
			user.turnWhitelist = true;
			user.sendChatMessage('', 'You may now take turns.');
			return;
		}

		if (this.Config.auth.enabled) {
			user.sendChatMessage('', 'This server does not support staff passwords. Please log in to become staff.');
			return;
		}

		if (pwdHash === this.Config.collabvm.adminpass) {
			user.rank = Rank.Admin;
			user.sendAdminLoginResponse(true, undefined);
		} else if (this.Config.collabvm.moderatorEnabled && pwdHash === this.Config.collabvm.modpass) {
			user.rank = Rank.Moderator;
			user.sendAdminLoginResponse(true, this.ModPerms);
		} else {
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
		if (!this.voteInProgress) return;
		this.endVote(choice == 1);
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
		if (enabled) {
			this.turnsAllowed = true;
		} else {
			this.turnsAllowed = false;
			this.clearTurns();
		}
	}

	onAdminIndefiniteTurn(user: User): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.infiniteturn)) return;
		this.indefiniteTurn = user;
		this.TurnQueue = Queue.from([user, ...this.TurnQueue.toArray().filter((c) => c !== user)]);
		this.sendTurnUpdate();
	}

	async onAdminHideScreen(user: User, show: boolean) {
		if (user.rank !== Rank.Admin) return;
		if (show) {
			// if(!this.screenHidden) return; ?

			this.screenHidden = false;
			let displaySize = this.VM.GetDisplay()?.Size();

			if(displaySize == undefined)
				return;

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
			this.logger.info(`Rename ${client.IP.address} from ${oldname} to ${client.username}`);
			if (announce) this.clients.forEach((c) => c.sendRename(oldname, client.username!, client.rank));
		} else {
			this.logger.info(`Rename ${client.IP.address} to ${client.username}`);
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

	private sendTurnUpdate(client?: User) {
		var turnQueueArr = this.TurnQueue.toArray();
		var turntime: number;
		if (this.indefiniteTurn === null) turntime = this.TurnTime * 1000;
		else turntime = 9999999999;
		var users: string[] = [];

		this.TurnQueue.forEach((c) => users.push(c.username!));

		var currentTurningUser = this.TurnQueue.peek();

		if (client) {
			client.sendTurnQueue(turntime, users);
			return;
		}

		this.clients
			.filter((c) => c !== currentTurningUser && c.connectedToNode)
			.forEach((c) => {
				if (turnQueueArr.indexOf(c) !== -1) {
					var time;
					if (this.indefiniteTurn === null) time = this.TurnTime * 1000 + (turnQueueArr.indexOf(c) - 1) * this.Config.collabvm.turnTime * 1000;
					else time = 9999999999;
					c.sendTurnQueueWaiting(turntime, users, time);
				} else {
					c.sendTurnQueue(turntime, users);
				}
			});
		if (currentTurningUser) currentTurningUser.sendTurnQueue(turntime, users);
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

	bypassTurn(client: User) {
		var a = this.TurnQueue.toArray().filter((c) => c !== client);
		this.TurnQueue = Queue.from([client, ...a]);
		this.nextTurn();
	}

	endTurn(client: User) {
		// I must have somehow accidentally removed this while scalpaling everything out
		if (this.indefiniteTurn === client) this.indefiniteTurn = null;
		var hasTurn = this.TurnQueue.peek() === client;
		this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter((c) => c !== client));
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

	startVote() {
		if (this.voteInProgress) return;
		this.voteInProgress = true;
		this.clients.forEach((c) => c.sendVoteStarted());
		this.voteTime = this.Config.collabvm.voteTime;
		this.voteInterval = setInterval(() => {
			this.voteTime--;
			if (this.voteTime < 1) {
				this.endVote();
			}
		}, 1000);
	}

	endVote(result?: boolean) {
		if (!this.voteInProgress) return;
		this.voteInProgress = false;
		clearInterval(this.voteInterval);
		var count = this.getVoteCounts();
		this.clients.forEach((c) => c.sendVoteEnded());
		if (result === true || (result === undefined && count.yes >= count.no)) {
			this.clients.forEach((c) => c.sendChatMessage('', 'The vote to reset the VM has won.'));
			this.VM.Reset();
		} else {
			this.clients.forEach((c) => c.sendChatMessage('', 'The vote to reset the VM has lost.'));
		}
		this.clients.forEach((c) => {
			c.IP.vote = null;
		});
		this.voteCooldown = this.Config.collabvm.voteCooldown;
		this.voteCooldownInterval = setInterval(() => {
			this.voteCooldown--;
			if (this.voteCooldown < 1) clearInterval(this.voteCooldownInterval);
		}, 1000);
	}

	sendVoteUpdate(client?: User) {
		if (!this.voteInProgress) return;
		var count = this.getVoteCounts();

		if (client) client.sendVoteStats(this.voteTime * 1000, count.yes, count.no);
		else this.clients.forEach((c) => c.sendVoteStats(this.voteTime * 1000, count.yes, count.no));
	}

	getVoteCounts(): VoteTally {
		let yes = 0;
		let no = 0;
		IPDataManager.ForEachIPData((c) => {
			if (c.vote === true) yes++;
			if (c.vote === false) no++;
		});
		return { yes: yes, no: no };
	}
}
