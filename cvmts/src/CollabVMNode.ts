import { QemuVmDefinition, VMState } from '@computernewb/superqemu';
import IConfig, { NodeConfiguration } from './IConfig.js';
import VM from './vm/interface.js';
import { QemuVMShim } from './vm/qemu.js';
import VNCVM from './vm/vnc/VNCVM.js';
import path from 'path';
// FIXME: When we bump mnemonist, this will become acceptable syntax
//import { CircularBuffer, Queue } from 'mnemonist';
import CircularBuffer from 'mnemonist/circular-buffer.js';
import Queue from 'mnemonist/queue.js';
import { Rank, User } from './User.js';
import { readFileSync } from 'fs';
import { Rect, Size } from './Utilities.js';

import * as Utilities from './Utilities.js';
import CollabVMServer from './CollabVMServer.js';
import { createHash } from 'crypto';
import { TheAuditLog } from './AuditLog.js';
import { ListEntry, ProtocolAddUser, ProtocolFlag, ProtocolRenameStatus } from './protocol/Protocol.js';
import { JPEGEncoder } from './JPEGEncoder.js';
import { IPDataManager } from './IPData.js';
import pino from 'pino';

// Instead of strange hacks we can just use nodejs provided
// import.meta properties, which have existed since LTS if not before
const __dirname = import.meta.dirname;

const kCVMTSAssetsRoot = path.resolve(__dirname, '../../assets');

type ChatHistory = {
	user: string;
	msg: string;
};

type VoteTally = {
	yes: number;
	no: number;
};

/// Createes a VM instance
function createVMFromConfiguration(nodeConfig: NodeConfiguration): VM {
	switch (nodeConfig.vm.type) {
		case 'qemu': {
			let def: QemuVmDefinition = {
				id: nodeConfig.collabvm.node,
				command: nodeConfig.vm.qemu.qemuArgs,
				snapshot: nodeConfig.vm.qemu.snapshots,
				forceTcp: false,
				vncHost: '127.0.0.1',
				vncPort: nodeConfig.vm.qemu.vncPort
			};

			return new QemuVMShim(def, nodeConfig.vm.qemu.resourceLimits);
			break;
		}
		case 'vncvm': {
			return new VNCVM(nodeConfig.vm.vncvm);
			break;
		}
		default: {
			console.error(`Invalid VM type in config: ${nodeConfig.vm.type}`);
			process.exit(1);
		}
	}
}

const kRestartTimeout = 5000;

// base64 image to show when the screen is hidden
let gScreenHiddenImage = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhidden.jpeg'));
let gScreenHiddenThumbnail = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhiddenthumb.jpeg'));
let gScreenNoDisplayImage = readFileSync(path.join(kCVMTSAssetsRoot, 'nodisplay.jpeg'));
let gScreenNoDisplayThumbnail = readFileSync(path.join(kCVMTSAssetsRoot, 'nodisplay_thumbnail.jpeg'));

/// A CollabVM node.
export class CollabVMNode {
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

	// Indefinite turn
	private indefiniteTurn: User | null;
	private ModPerms: number;
	private VM: VM;

	private NodeConfig;
	private Config;

	private Server;

	// queue of rects, reset every frame
	private rectQueue: Rect[] = [];

	private logger;

	private stoppingNode = false;

	private addedDisplayEvents = false;

	constructor(config: IConfig, nodeConfig: NodeConfiguration, server: CollabVMServer) {
		this.logger = pino({ name: `CVMTS.Node/${nodeConfig.collabvm.node}` });
		this.Config = config;
		this.NodeConfig = nodeConfig;

		this.Server = server;

		this.VM = createVMFromConfiguration(nodeConfig);

		this.ChatHistory = new CircularBuffer<ChatHistory>(Array, this.Config.collabvm.maxChatHistoryLength);
		this.TurnQueue = new Queue<User>();
		this.TurnTime = 0;
		this.clients = [];
		this.voteInProgress = false;
		this.voteTime = 0;
		this.voteCooldown = 0;
		this.turnsAllowed = true;

		this.screenHidden = false;

		this.indefiniteTurn = null;
		this.ModPerms = Utilities.MakeModPerms(config.collabvm.moderatorPermissions);
		this.initNode();
	}

	private initNode() {
		// No size initially, since there usually won't be a display connected at all during initalization
		this.OnDisplayResized({
			width: 0,
			height: 0
		});

		let self = this;

		this.VM.Events().on('statechange', (newState: VMState) => {
			switch (newState) {
				case VMState.Started:
					{
						self.logger.info('VM started');
						self.VM.StartDisplay();

						// We only need to do this once, since each VM
						// only uses one display class and doesn't recreate it.
						if (!self.addedDisplayEvents) {
							self.addedDisplayEvents = true;
							self.logger.info('adding events now');

							// add events
							self.VM.GetDisplay()?.on('resize', (size: Size) => self.OnDisplayResized(size));
							self.VM.GetDisplay()?.on('rect', (rect: Rect) => self.OnDisplayRectangle(rect));
							self.VM.GetDisplay()?.on('frame', () => self.OnDisplayFrame());

							// wasteful but /shrug
							self.VM.GetDisplay()?.on('disconnect', () => {
								self.clients.map((c) => {
									self.SendFullScreenWithSize(c);
								});
							});
						}
					}
					break;
				case VMState.Stopping:
					self.VM.GetDisplay()?.Disconnect();
					break;
				default:
					break;
			}
		});
	}

	async Start() {
		// do what it says on the tin
		await this.VM.Start();
	}

	async Stop() {
		// set the flag which tells us "hey we are actually supposed to stop".
		this.stoppingNode = true;
		await this.VM.Stop();
	}

	async addUser(user: User) {
		let sameip = this.clients.filter((c) => c.IP.address === user.IP.address);
		if (sameip.length >= this.Config.collabvm.maxConnections) {
			// Kick the oldest client
			// I think this is a better solution than just rejecting the connection
			sameip[0].kick();
		}

		// user sent a username they requested when initially renaming to the server,
		// so let's obey that (if we can)
		// FIXME: it should be possible to make this less janky.
		if (user.username) {
			if (this.getUsernameList().indexOf(user.username) !== -1) {
				user.assignGuestName(this.getUsernameList());
				this.renameUser(user, user.username, false);
			} else {
				this.renameUser(user, user.username, true);
			}
		} else {
			// ok then
			this.renameUser(user, undefined, true);
		}

		this.clients.push(user);

		// set the node.
		user.Node = this;

		user.sendConnectOKResponse(this.VM.SnapshotsSupported());

		// broadcast we exist to everyone
		this.clients
			.filter((c) => c !== user)
			.map((c) =>
				c.sendAddUser([
					{
						username: user.username!,
						rank: user.rank
					}
				])
			);

		user.sendAddUser(this.getAddUser());

		if (this.Config.geoip.enabled) {
			let flags = this.getFlags();
			user.sendFlag(flags);
		}

		if (this.ChatHistory.size !== 0) {
			let history = this.ChatHistory.toArray() as ChatHistory[];
			user.sendChatHistoryMessage(history);
		}

		// fallback
		if (this.NodeConfig.collabvm.motd) {
			user.sendChatMessage('', this.NodeConfig.collabvm.motd);
		} else {
			if (this.Config.collabvm.motd) user.sendChatMessage('', this.Config.collabvm.motd);
		}

		if (this.screenHidden) {
			user?.sendScreenResize(1024, 768);
			user?.sendScreenUpdate({
				x: 0,
				y: 0,
				data: gScreenHiddenImage
			});
		} else {
			await this.SendFullScreenWithSize(user);
		}

		user.sendSync(Date.now());

		if (this.voteInProgress) this.sendVoteUpdate(user);
		this.sendTurnUpdate(user);
	}

	removeUser(user: User) {
		let clientIndex = this.clients.indexOf(user);
		if (clientIndex === -1) return;

		if (user.IP.vote != null) {
			user.IP.vote = null;
			this.sendVoteUpdate();
		}

		if (this.indefiniteTurn === user) this.indefiniteTurn = null;

		this.clients.splice(clientIndex, 1);

		user.Node = null;

		if (!user.username) return;
		if (this.TurnQueue.toArray().indexOf(user) !== -1) {
			var hadturn = this.TurnQueue.peek() === user;
			this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter((u) => u !== user));
			if (hadturn) this.nextTurn();
		}

		this.clients.forEach((c) => c.sendRemUser([user.username!]));
	}

	// does auth check
	private authCheck(user: User, guestPermission: boolean) {
		if (!this.Config.auth.enabled) return true;

		if (user.rank === Rank.Unregistered && !guestPermission) {
			user.sendChatMessage('', 'You need to login to do that.');
			return false;
		}

		return true;
	}

	async onLogin(user: User, token: string) {
		try {
			let res = await this.Server.auth!.Authenticate(token, user);

			if (res.clientSuccess) {
				this.logger.info(`${user.IP.address} logged in as ${res.username}`);
				user.sendLoginResponse(true, '');

				let old = this.clients.find((c) => c.username === res.username);
				if (old) {
					// kick() doesnt wait until the user is actually removed from the list and itd be anal to make it do that
					// so we call connectionClosed manually here. When it gets called on kick(), it will return because the user isn't in the list
					this.removeUser(old);
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

	onVote(user: User, choice: number) {
		let hasTurnWhitelist = false;
		if (this.NodeConfig.collabvm.turnwhitelist !== undefined) hasTurnWhitelist = this.NodeConfig.collabvm.turnwhitelist;
		else hasTurnWhitelist = this.Config.collabvm.turnwhitelist;

		if (!this.VM.SnapshotsSupported()) return;
		if ((!this.turnsAllowed || hasTurnWhitelist) && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
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

	onTurnRequest(user: User, forfeit: boolean) {
		let hasTurnWhitelist = false;
		if (this.NodeConfig.collabvm.turnwhitelist !== undefined) hasTurnWhitelist = this.NodeConfig.collabvm.turnwhitelist;
		else hasTurnWhitelist = this.Config.collabvm.turnwhitelist;

		if ((!this.turnsAllowed || hasTurnWhitelist) && user.rank !== Rank.Admin && user.rank !== Rank.Moderator && !user.turnWhitelist) return;
		if (!this.authCheck(user, this.Config.auth.guestPermissions.turn)) return;
		if (!user.TurnRateLimit.request()) return;

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

	onRename(user: User, newName: string | undefined): void {
		if (!user.RenameRateLimit.request()) return;
		if (user.IP.muted) return;
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

		let hasTurnWhitelist = false;
		let turnPass = '';

		if (this.NodeConfig.collabvm.turnwhitelist !== undefined) hasTurnWhitelist = this.NodeConfig.collabvm.turnwhitelist;
		else hasTurnWhitelist = this.Config.collabvm.turnwhitelist;

		if (this.NodeConfig.collabvm.turnpass !== undefined) turnPass = this.NodeConfig.collabvm.turnpass;
		else turnPass = this.Config.collabvm.turnpass;

		if (hasTurnWhitelist && pwdHash === turnPass) {
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
		if (node !== this.NodeConfig.collabvm.node) return;
		TheAuditLog.onMonitorCommand(node, user, command);
		let output = await this.VM.MonitorCommand(command);
		user.sendAdminMonitorResponse(String(output));
	}

	onAdminRestore(user: User, node: string): void {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.restore)) return;
		TheAuditLog.onReset(node, user);
		this.VM.Reset();
	}

	async onAdminReboot(user: User, node: string) {
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.reboot)) return;
		if (node !== this.NodeConfig.collabvm.node) return;
		TheAuditLog.onReboot(node, user);
		await this.VM.Reboot();
	}

	async onAdminBanUser(user: User, username: string) {
		// Ban
		if (user.rank !== Rank.Admin && (user.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.ban)) return;
		let target = this.clients.find((c) => c.username === username);
		if (!target) return;
		TheAuditLog.onBan(this.NodeConfig.collabvm.node, user, target);
		await target.ban(this.Server.banmgr);
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
		TheAuditLog.onKick(this.NodeConfig.collabvm.node, user, target);
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
		if (node !== this.NodeConfig.collabvm.node) return;
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
		if (user.rank !== Rank.Admin) return;
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

			if (displaySize == undefined) return;
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
						data: gScreenHiddenImage
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
		return this.clients.filter((c) => c.username != undefined).map((c) => c.username!);
	}

	renameUser(client: User, newName?: string, announce: boolean = true) {
		// This shouldn't need a ternary but it does for some reason
		let hadName = client.username ? true : false;
		let oldname: string | undefined;
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
				status = ProtocolRenameStatus.UsernameTaken;
				client.assignGuestName(this.getUsernameList());
			} else if (!/^[a-zA-Z0-9\ \-\_\.]+$/.test(newName) || newName.length > 20 || newName.length < 3) {
				client.assignGuestName(this.getUsernameList());
				status = ProtocolRenameStatus.UsernameInvalid;
			} else if (this.Config.collabvm.usernameblacklist.indexOf(newName) !== -1) {
				status = ProtocolRenameStatus.UsernameNotAllowed;
				client.assignGuestName(this.getUsernameList());
			} else client.username = newName;
		}

		client.sendSelfRename(status, client.username!, client.rank);

		if (hadName) {
			this.logger.info(`Rename ${client.IP.address} from ${oldname} to ${client.username}`);
			if (announce) this.clients.forEach((c) => c.sendRename(oldname!, client.username!, client.rank));
		} else {
			this.logger.info(`Rename ${client.IP.address} to ${client.username}`);
			if (announce) {
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
			// fallback
			if (this.NodeConfig.collabvm.turnTime) {
				this.TurnTime = this.NodeConfig.collabvm.turnTime;
			} else {
				this.TurnTime = this.Config.collabvm.turnTime;
			}

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
		if (display?.Connected()) {
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
		} else {
			client.sendScreenResize(1024, 768);

			client.sendScreenUpdate({
				x: 0,
				y: 0,
				data: gScreenNoDisplayImage
			});
		}
	}

	private async MakeRectData(rect: Rect) {
		let display = this.VM.GetDisplay();
		let buffer: Buffer;
		let displaySize: Size;

		// hack. Should we provide images for "VM Down"?
		if (display?.Connected()) {
			buffer = display?.Buffer();
			displaySize = display.Size();
		} else {
			return gScreenNoDisplayImage;
		}

		let encoded = await JPEGEncoder.Encode(buffer, displaySize, rect, this.NodeConfig.vm.jpegQuality);

		return encoded;
	}

	async getThumbnail(): Promise<Buffer> {
		let display = this.VM.GetDisplay();

		// oh well
		if (!display?.Connected()) {
			return gScreenNoDisplayThumbnail;
		}

		return JPEGEncoder.EncodeThumbnail(display.Buffer(), display.Size(), this.NodeConfig.vm.jpegQuality);
	}

	startVote() {
		if (this.voteInProgress) return;
		this.voteInProgress = true;
		this.clients.forEach((c) => c.sendVoteStarted());

		if (this.NodeConfig.collabvm.voteTime) this.voteTime = this.NodeConfig.collabvm.voteTime;
		else this.voteTime = this.Config.collabvm.voteTime;

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

		let count = this.getVoteCounts();
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

		if (this.NodeConfig.collabvm.voteCooldown) this.voteCooldown = this.NodeConfig.collabvm.voteCooldown;
		else this.voteCooldown = this.Config.collabvm.voteCooldown;

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

	isVMStarted() {
		return this.VM.GetState() == VMState.Started;
	}

	async getListEntry(): Promise<ListEntry> {
		return {
			id: this.NodeConfig.collabvm.node,
			name: this.NodeConfig.collabvm.displayname,
			thumbnail: this.screenHidden ? gScreenHiddenThumbnail : await this.getThumbnail()
		};
	}
}
