import IConfig from './IConfig.js';
import * as Utilities from './Utilities.js';
import { User, Rank } from './User.js';
import * as cvm from '@cvmts/cvm-rs';
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
import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from '@cvmts/collab-vm-1.2-binary-protocol';

import { Size, Rect } from './Utilities.js';
import pino from 'pino';
import { BanManager } from './BanManager.js';
import { TheAuditLog } from './AuditLog.js';

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

export default class CollabVMServer {
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
	private screenHiddenImg: string;
	private screenHiddenThumb: string;

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
		this.screenHiddenImg = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhidden.jpeg')).toString('base64');
		this.screenHiddenThumb = readFileSync(path.join(kCVMTSAssetsRoot, 'screenhiddenthumb.jpeg')).toString('base64');

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

	public addUser(user: User) {
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
		user.socket.on('msg', (msg: string) => this.onMessage(user, msg));
		user.socket.on('disconnect', () => this.connectionClosed(user));
		if (this.Config.auth.enabled) {
			user.sendMsg(cvm.guacEncode('auth', this.Config.auth.apiEndpoint));
		}
		user.sendMsg(this.getAdduserMsg());
		if (this.Config.geoip.enabled) user.sendMsg(this.getFlagMsg());
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

		this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('remuser', '1', user.username!)));
	}

	private async onMessage(client: User, message: string) {
		try {
			var msgArr = cvm.guacDecode(message);
			if (msgArr.length < 1) return;
			switch (msgArr[0]) {
				case 'login':
					if (msgArr.length !== 2 || !this.Config.auth.enabled) return;
					if (!client.connectedToNode) {
						client.sendMsg(cvm.guacEncode('login', '0', 'You must connect to the VM before logging in.'));
						return;
					}
					try {
						let res = await this.auth!.Authenticate(msgArr[1], client);
						if (res.clientSuccess) {
							this.logger.info(`${client.IP.address} logged in as ${res.username}`);
							client.sendMsg(cvm.guacEncode('login', '1'));
							let old = this.clients.find((c) => c.username === res.username);
							if (old) {
								// kick() doesnt wait until the user is actually removed from the list and itd be anal to make it do that
								// so we call connectionClosed manually here. When it gets called on kick(), it will return because the user isn't in the list
								this.connectionClosed(old);
								await old.kick();
							}
							// Set username
							if (client.countryCode !== null && client.noFlag) {
								// privacy
								for (let cl of this.clients.filter((c) => c !== client)) {
									cl.sendMsg(cvm.guacEncode('remuser', '1', client.username!));
								}
								this.renameUser(client, res.username, false);
							} else this.renameUser(client, res.username, true);
							// Set rank
							client.rank = res.rank;
							if (client.rank === Rank.Admin) {
								client.sendMsg(cvm.guacEncode('admin', '0', '1'));
							} else if (client.rank === Rank.Moderator) {
								client.sendMsg(cvm.guacEncode('admin', '0', '3', this.ModPerms.toString()));
							}
							this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('adduser', '1', client.username!, client.rank.toString())));
						} else {
							client.sendMsg(cvm.guacEncode('login', '0', res.error!));
							if (res.error === 'You are banned') {
								client.kick();
							}
						}
					} catch (err) {
						this.logger.error(`Error authenticating client ${client.IP.address}: ${(err as Error).message}`);
						// for now?
						client.sendMsg(cvm.guacEncode('login', '0', 'There was an internal error while authenticating. Please let a staff member know as soon as possible'));
					}
					break;
				case 'noflag': {
					if (client.connectedToNode)
						// too late
						return;
					client.noFlag = true;
				}
				case 'list':
					if (this.VM.GetState() == VMState.Started) {
						client.sendMsg(cvm.guacEncode('list', this.Config.collabvm.node, this.Config.collabvm.displayname, this.screenHidden ? this.screenHiddenThumb : await this.getThumbnail()));
					}
					break;
				case 'connect':
					if (!client.username || msgArr.length !== 2 || msgArr[1] !== this.Config.collabvm.node) {
						client.sendMsg(cvm.guacEncode('connect', '0'));
						return;
					}

					client.connectedToNode = true;
					client.sendMsg(cvm.guacEncode('connect', '1', '1', this.VM.SnapshotsSupported() ? '1' : '0', '0'));
					if (this.ChatHistory.size !== 0) client.sendMsg(this.getChatHistoryMsg());
					if (this.Config.collabvm.motd) client.sendMsg(cvm.guacEncode('chat', '', this.Config.collabvm.motd));
					if (this.screenHidden) {
						client.sendMsg(cvm.guacEncode('size', '0', '1024', '768'));
						client.sendMsg(cvm.guacEncode('png', '0', '0', '0', '0', this.screenHiddenImg));
					} else {
						await this.SendFullScreenWithSize(client);
					}
					client.sendMsg(cvm.guacEncode('sync', Date.now().toString()));
					if (this.voteInProgress) this.sendVoteUpdate(client);
					this.sendTurnUpdate(client);
					break;
				case 'view':
					if (client.connectedToNode) return;
					if (client.username || msgArr.length !== 3 || msgArr[1] !== this.Config.collabvm.node) {
						// The use of connect here is intentional.
						client.sendMsg(cvm.guacEncode('connect', '0'));
						return;
					}

					switch (msgArr[2]) {
						case '0':
							client.viewMode = 0;
							break;
						case '1':
							client.viewMode = 1;
							break;
						default:
							client.sendMsg(cvm.guacEncode('connect', '0'));
							return;
					}

					client.sendMsg(cvm.guacEncode('connect', '1', '1', this.VM.SnapshotsSupported() ? '1' : '0', '0'));
					if (this.ChatHistory.size !== 0) client.sendMsg(this.getChatHistoryMsg());
					if (this.Config.collabvm.motd) client.sendMsg(cvm.guacEncode('chat', '', this.Config.collabvm.motd));

					if (client.viewMode == 1) {
						if (this.screenHidden) {
							client.sendMsg(cvm.guacEncode('size', '0', '1024', '768'));
							client.sendMsg(cvm.guacEncode('png', '0', '0', '0', '0', this.screenHiddenImg));
						} else {
							await this.SendFullScreenWithSize(client);
						}
						client.sendMsg(cvm.guacEncode('sync', Date.now().toString()));
					}

					if (this.voteInProgress) this.sendVoteUpdate(client);
					this.sendTurnUpdate(client);
					break;
				case 'rename':
					if (!client.RenameRateLimit.request()) return;
					if (client.connectedToNode && client.IP.muted) return;
					if (this.Config.auth.enabled && client.rank !== Rank.Unregistered) {
						client.sendMsg(cvm.guacEncode('chat', '', 'Go to your account settings to change your username.'));
						return;
					}
					if (this.Config.auth.enabled && msgArr[1] !== undefined) {
						// Don't send system message to a user without a username since it was likely an automated attempt by the webapp
						if (client.username) client.sendMsg(cvm.guacEncode('chat', '', 'You need to log in to do that.'));
						if (client.rank !== Rank.Unregistered) return;
						this.renameUser(client, undefined);
						return;
					}
					this.renameUser(client, msgArr[1]);
					break;
				case 'chat':
					if (!client.username) return;
					if (client.IP.muted) return;
					if (msgArr.length !== 2) return;
					if (this.Config.auth.enabled && client.rank === Rank.Unregistered && !this.Config.auth.guestPermissions.chat) {
						client.sendMsg(cvm.guacEncode('chat', '', 'You need to login to do that.'));
						return;
					}
					var msg = Utilities.HTMLSanitize(msgArr[1]);
					// One of the things I hated most about the old server is it completely discarded your message if it was too long
					if (msg.length > this.Config.collabvm.maxChatLength) msg = msg.substring(0, this.Config.collabvm.maxChatLength);
					if (msg.trim().length < 1) return;

					this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', client.username!, msg)));
					this.ChatHistory.push({ user: client.username, msg: msg });
					client.onMsgSent();
					break;
				case 'turn':
					if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && client.rank !== Rank.Admin && client.rank !== Rank.Moderator && !client.turnWhitelist) return;
					if (this.Config.auth.enabled && client.rank === Rank.Unregistered && !this.Config.auth.guestPermissions.turn) {
						client.sendMsg(cvm.guacEncode('chat', '', 'You need to login to do that.'));
						return;
					}
					if (!client.TurnRateLimit.request()) return;
					if (!client.connectedToNode) return;
					if (msgArr.length > 2) return;
					var takingTurn: boolean;
					if (msgArr.length === 1) takingTurn = true;
					else
						switch (msgArr[1]) {
							case '0':
								if (this.indefiniteTurn === client) {
									this.indefiniteTurn = null;
								}
								takingTurn = false;
								break;
							case '1':
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
						if (this.Config.collabvm.turnlimit.enabled) {
							// Get the amount of users in the turn queue with the same IP as the user requesting a turn.
							let turns = currentQueue.filter((user) => user.IP.address == client.IP.address);
							// If it exceeds the limit set in the config, ignore the turn request.
							if (turns.length + 1 > this.Config.collabvm.turnlimit.maximum) return;
						}
						this.TurnQueue.enqueue(client);
						if (this.TurnQueue.size === 1) this.nextTurn();
					} else {
						var hadturn = this.TurnQueue.peek() === client;
						this.TurnQueue = Queue.from(this.TurnQueue.toArray().filter((u) => u !== client));
						if (hadturn) this.nextTurn();
					}
					this.sendTurnUpdate();
					break;
				case 'mouse':
					if (this.TurnQueue.peek() !== client && client.rank !== Rank.Admin) return;
					var x = parseInt(msgArr[1]);
					var y = parseInt(msgArr[2]);
					var mask = parseInt(msgArr[3]);
					if (x === undefined || y === undefined || mask === undefined) return;
					this.VM.GetDisplay()?.MouseEvent(x, y, mask);
					break;
				case 'key':
					if (this.TurnQueue.peek() !== client && client.rank !== Rank.Admin) return;
					var keysym = parseInt(msgArr[1]);
					var down = parseInt(msgArr[2]);
					if (keysym === undefined || (down !== 0 && down !== 1)) return;
					this.VM.GetDisplay()?.KeyboardEvent(keysym, down === 1 ? true : false);
					break;
				case 'vote':
					if (!this.VM.SnapshotsSupported()) return;
					if ((!this.turnsAllowed || this.Config.collabvm.turnwhitelist) && client.rank !== Rank.Admin && client.rank !== Rank.Moderator && !client.turnWhitelist) return;
					if (!client.connectedToNode) return;
					if (msgArr.length !== 2) return;
					if (!client.VoteRateLimit.request()) return;
					switch (msgArr[1]) {
						case '1':
							if (!this.voteInProgress) {
								if (this.Config.auth.enabled && client.rank === Rank.Unregistered && !this.Config.auth.guestPermissions.callForReset) {
									client.sendMsg(cvm.guacEncode('chat', '', 'You need to login to do that.'));
									return;
								}

								if (this.voteCooldown !== 0) {
									client.sendMsg(cvm.guacEncode('vote', '3', this.voteCooldown.toString()));
									return;
								}
								this.startVote();
								this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', `${client.username} has started a vote to reset the VM.`)));
							}
							if (this.Config.auth.enabled && client.rank === Rank.Unregistered && !this.Config.auth.guestPermissions.vote) {
								client.sendMsg(cvm.guacEncode('chat', '', 'You need to login to do that.'));
								return;
							} else if (client.IP.vote !== true) {
								this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', `${client.username} has voted yes.`)));
							}
							client.IP.vote = true;
							break;
						case '0':
							if (!this.voteInProgress) return;
							if (this.Config.auth.enabled && client.rank === Rank.Unregistered && !this.Config.auth.guestPermissions.vote) {
								client.sendMsg(cvm.guacEncode('chat', '', 'You need to login to do that.'));
								return;
							}
							if (client.IP.vote !== false) {
								this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', `${client.username} has voted no.`)));
							}
							client.IP.vote = false;
							break;
					}
					this.sendVoteUpdate();
					break;
				case 'cap': {
					if (msgArr.length < 2) return;
					// Capabilities can only be announced before connecting to the VM
					if (client.connectedToNode) return;
					var caps = [];
					for (const cap of msgArr.slice(1))
						switch (cap) {
							case 'bin': {
								if (caps.indexOf('bin') !== -1) break;
								client.Capabilities.bin = true;
								caps.push('bin');
								break;
							}
						}
					client.sendMsg(cvm.guacEncode('cap', ...caps));
				}
				case 'admin':
					if (msgArr.length < 2) return;
					switch (msgArr[1]) {
						case '2':
							// Login

							if (!client.LoginRateLimit.request() || !client.username) return;
							if (msgArr.length !== 3) return;
							var sha256 = createHash('sha256');
							sha256.update(msgArr[2]);
							var pwdHash = sha256.digest('hex');
							sha256.destroy();

							if (this.Config.collabvm.turnwhitelist && pwdHash === this.Config.collabvm.turnpass) {
								client.turnWhitelist = true;
								client.sendMsg(cvm.guacEncode('chat', '', 'You may now take turns.'));
								return;
							}

							if (this.Config.auth.enabled) {
								client.sendMsg(cvm.guacEncode('chat', '', 'This server does not support staff passwords. Please log in to become staff.'));
								return;
							}

							if (pwdHash === this.Config.collabvm.adminpass) {
								client.rank = Rank.Admin;
								client.sendMsg(cvm.guacEncode('admin', '0', '1'));
							} else if (this.Config.collabvm.moderatorEnabled && pwdHash === this.Config.collabvm.modpass) {
								client.rank = Rank.Moderator;
								client.sendMsg(cvm.guacEncode('admin', '0', '3', this.ModPerms.toString()));
							} else {
								client.sendMsg(cvm.guacEncode('admin', '0', '0'));
								return;
							}
							if (this.screenHidden) {
								await this.SendFullScreenWithSize(client);

								client.sendMsg(cvm.guacEncode('sync', Date.now().toString()));
							}

							this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('adduser', '1', client.username!, client.rank.toString())));
							break;
						case '5':
							// QEMU Monitor
							if (client.rank !== Rank.Admin) return;
							if (msgArr.length !== 4 || msgArr[2] !== this.Config.collabvm.node) return;
							TheAuditLog.onMonitorCommand(client, msgArr[3]);
							let output = await this.VM.MonitorCommand(msgArr[3]);
							client.sendMsg(cvm.guacEncode('admin', '2', String(output)));
							break;
						case '8':
							// Restore
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.restore)) return;
							TheAuditLog.onReset(client);
							this.VM.Reset();
							break;
						case '10':
							// Reboot
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.reboot)) return;
							if (msgArr.length !== 3 || msgArr[2] !== this.Config.collabvm.node) return;
							TheAuditLog.onReboot(client);
							await this.VM.Reboot();
							break;
						case '12':
							// Ban
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.ban)) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							TheAuditLog.onBan(client, user);
							user.ban(this.banmgr);
						case '13':
							// Force Vote
							if (msgArr.length !== 3) return;
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.forcevote)) return;
							if (!this.voteInProgress) return;
							switch (msgArr[2]) {
								case '1':
									this.endVote(true);
									break;
								case '0':
									this.endVote(false);
									break;
							}
							break;
						case '14':
							// Mute
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.mute)) return;
							if (msgArr.length !== 4) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							var permamute;
							switch (msgArr[3]) {
								case '0':
									permamute = false;
									break;
								case '1':
									permamute = true;
									break;
								default:
									return;
							}
							//TheAdminLogger.onMute(client, user, permamute);
							user.mute(permamute);
							break;
						case '15':
							// Kick
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.kick)) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							TheAuditLog.onKick(client, user);
							user.kick();
							break;
						case '16':
							// End turn
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
							if (msgArr.length !== 3) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							this.endTurn(user);
							break;
						case '17':
							// Clear turn queue
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
							if (msgArr.length !== 3 || msgArr[2] !== this.Config.collabvm.node) return;
							this.clearTurns();
							break;
						case '18':
							// Rename user
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.rename)) return;
							if (this.Config.auth.enabled) {
								client.sendMsg(cvm.guacEncode('chat', '', 'Cannot rename users on a server that uses authentication.'));
							}
							if (msgArr.length !== 4) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							this.renameUser(user, msgArr[3]);
							break;
						case '19':
							// Get IP
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.grabip)) return;
							if (msgArr.length !== 3) return;
							var user = this.clients.find((c) => c.username === msgArr[2]);
							if (!user) return;
							client.sendMsg(cvm.guacEncode('admin', '19', msgArr[2], user.IP.address));
							break;
						case '20':
							// Steal turn
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.bypassturn)) return;
							this.bypassTurn(client);
							break;
						case '21':
							// XSS
							if (client.rank !== Rank.Admin && (client.rank !== Rank.Moderator || !this.Config.collabvm.moderatorPermissions.xss)) return;
							if (msgArr.length !== 3) return;
							switch (client.rank) {
								case Rank.Admin:
									this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', client.username!, msgArr[2])));

									this.ChatHistory.push({ user: client.username!, msg: msgArr[2] });
									break;
								case Rank.Moderator:
									this.clients.filter((c) => c.rank !== Rank.Admin).forEach((c) => c.sendMsg(cvm.guacEncode('chat', client.username!, msgArr[2])));

									this.clients.filter((c) => c.rank === Rank.Admin).forEach((c) => c.sendMsg(cvm.guacEncode('chat', client.username!, Utilities.HTMLSanitize(msgArr[2]))));
									break;
							}
							break;
						case '22':
							// Toggle turns
							if (client.rank !== Rank.Admin) return;
							if (msgArr.length !== 3) return;
							switch (msgArr[2]) {
								case '0':
									this.clearTurns();
									this.turnsAllowed = false;
									break;
								case '1':
									this.turnsAllowed = true;
									break;
							}
							break;
						case '23':
							// Indefinite turn
							if (client.rank !== Rank.Admin) return;
							this.indefiniteTurn = client;
							this.TurnQueue = Queue.from([client, ...this.TurnQueue.toArray().filter((c) => c !== client)]);
							this.sendTurnUpdate();
							break;
						case '24':
							// Hide screen
							if (client.rank !== Rank.Admin) return;
							if (msgArr.length !== 3) return;
							switch (msgArr[2]) {
								case '0':
									this.screenHidden = true;
									this.clients
										.filter((c) => c.rank == Rank.Unregistered)
										.forEach((client) => {
											client.sendMsg(cvm.guacEncode('size', '0', '1024', '768'));
											client.sendMsg(cvm.guacEncode('png', '0', '0', '0', '0', this.screenHiddenImg));
											client.sendMsg(cvm.guacEncode('sync', Date.now().toString()));
										});
									break;
								case '1':
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
									break;
							}
							break;
						case '25':
							if (client.rank !== Rank.Admin || msgArr.length !== 3) return;
							this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', msgArr[2])));
							break;
					}
					break;
			}
		} catch (err) {
			// No
			this.logger.error(`User ${user?.IP.address} ${user?.username ? `with username ${user?.username}` : ''} sent broken Guacamole: ${err as Error}`);
			user?.kick();
		}
	}

	getUsernameList(): string[] {
		var arr: string[] = [];

		this.clients.filter((c) => c.username).forEach((c) => arr.push(c.username!));
		return arr;
	}

	renameUser(client: User, newName?: string, announce: boolean = true) {
		// This shouldn't need a ternary but it does for some reason
		var hadName: boolean = client.username ? true : false;
		var oldname: any;
		if (hadName) oldname = client.username;
		var status = '0';
		if (!newName) {
			client.assignGuestName(this.getUsernameList());
		} else {
			newName = newName.trim();
			if (hadName && newName === oldname) {
				client.sendMsg(cvm.guacEncode('rename', '0', '0', client.username!, client.rank.toString()));
				return;
			}
			if (this.getUsernameList().indexOf(newName) !== -1) {
				client.assignGuestName(this.getUsernameList());
				if (client.connectedToNode) {
					status = '1';
				}
			} else if (!/^[a-zA-Z0-9\ \-\_\.]+$/.test(newName) || newName.length > 20 || newName.length < 3) {
				client.assignGuestName(this.getUsernameList());
				status = '2';
			} else if (this.Config.collabvm.usernameblacklist.indexOf(newName) !== -1) {
				client.assignGuestName(this.getUsernameList());
				status = '3';
			} else client.username = newName;
		}

		client.sendMsg(cvm.guacEncode('rename', '0', status, client.username!, client.rank.toString()));
		if (hadName) {
			this.logger.info(`Rename ${client.IP.address} from ${oldname} to ${client.username}`);
			if (announce) this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('rename', '1', oldname, client.username!, client.rank.toString())));
		} else {
			this.logger.info(`Rename ${client.IP.address} to ${client.username}`);
			if (announce)
				this.clients.forEach((c) => {
					c.sendMsg(cvm.guacEncode('adduser', '1', client.username!, client.rank.toString()));
					if (client.countryCode !== null) c.sendMsg(cvm.guacEncode('flag', client.username!, client.countryCode));
				});
		}
	}

	getAdduserMsg(): string {
		var arr: string[] = ['adduser', this.clients.filter((c) => c.username).length.toString()];

		this.clients.filter((c) => c.username).forEach((c) => arr.push(c.username!, c.rank.toString()));
		return cvm.guacEncode(...arr);
	}

	getFlagMsg(): string {
		var arr = ['flag'];
		for (let c of this.clients.filter((cl) => cl.countryCode !== null && cl.username && (!cl.noFlag || cl.rank === Rank.Unregistered))) {
			arr.push(c.username!, c.countryCode!);
		}
		return cvm.guacEncode(...arr);
	}

	getChatHistoryMsg(): string {
		var arr: string[] = ['chat'];
		this.ChatHistory.forEach((c) => arr.push(c.user, c.msg));
		return cvm.guacEncode(...arr);
	}

	private sendTurnUpdate(client?: User) {
		var turnQueueArr = this.TurnQueue.toArray();
		var turntime;
		if (this.indefiniteTurn === null) turntime = this.TurnTime * 1000;
		else turntime = 9999999999;
		var arr = ['turn', turntime.toString(), this.TurnQueue.size.toString()];
		// @ts-ignore
		this.TurnQueue.forEach((c) => arr.push(c.username));
		var currentTurningUser = this.TurnQueue.peek();
		if (client) {
			client.sendMsg(cvm.guacEncode(...arr));
			return;
		}
		this.clients
			.filter((c) => c !== currentTurningUser && c.connectedToNode)
			.forEach((c) => {
				if (turnQueueArr.indexOf(c) !== -1) {
					var time;
					if (this.indefiniteTurn === null) time = this.TurnTime * 1000 + (turnQueueArr.indexOf(c) - 1) * this.Config.collabvm.turnTime * 1000;
					else time = 9999999999;
					c.sendMsg(cvm.guacEncode(...arr, time.toString()));
				} else {
					c.sendMsg(cvm.guacEncode(...arr));
				}
			});
		if (currentTurningUser) currentTurningUser.sendMsg(cvm.guacEncode(...arr));
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
				c.sendMsg(cvm.guacEncode('size', '0', size.width.toString(), size.height.toString()));
			});
	}

	private async OnDisplayFrame() {
		let self = this;

		let doRect = async (rect: Rect) => {
			let encoded = await this.MakeRectData(rect);
			let encodedb64 = encoded.toString('base64');
			let bmsg: CollabVMProtocolMessage = {
				type: CollabVMProtocolMessageType.rect,
				rect: {
					x: rect.x,
					y: rect.y,
					data: encoded
				}
			};

			var encodedbin = msgpack.encode(bmsg);

			self.clients
				.filter((c) => c.connectedToNode || c.viewMode == 1)
				.forEach((c) => {
					if (self.screenHidden && c.rank == Rank.Unregistered) return;
					if (c.Capabilities.bin) {
						c.socket.sendBinary(encodedbin);
					} else {
						c.sendMsg(cvm.guacEncode('png', '0', '0', rect.x.toString(), rect.y.toString(), encodedb64));
						c.sendMsg(cvm.guacEncode('sync', Date.now().toString()));
					}
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

		client.sendMsg(cvm.guacEncode('size', '0', displaySize.width.toString(), displaySize.height.toString()));

		if (client.Capabilities.bin) {
			let msg: CollabVMProtocolMessage = {
				type: CollabVMProtocolMessageType.rect,
				rect: {
					x: 0,
					y: 0,
					data: encoded
				}
			};
			client.socket.sendBinary(msgpack.encode(msg));
		} else {
			client.sendMsg(cvm.guacEncode('png', '0', '0', '0', '0', encoded.toString('base64')));
		}
	}

	private async MakeRectData(rect: Rect) {
		let display = this.VM.GetDisplay();

		// TODO: actually throw an error here
		if (display == null) return Buffer.from('no');

		let displaySize = display.Size();
		let encoded = await JPEGEncoder.Encode(display.Buffer(), displaySize, rect);

		return encoded;
	}

	async getThumbnail(): Promise<string> {
		let display = this.VM.GetDisplay();

		// oh well
		if (!display?.Connected()) return '';

		let buf = await JPEGEncoder.EncodeThumbnail(display.Buffer(), display.Size());
		return buf.toString('base64');
	}

	startVote() {
		if (this.voteInProgress) return;
		this.voteInProgress = true;
		this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('vote', '0')));
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
		this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('vote', '2')));
		if (result === true || (result === undefined && count.yes >= count.no)) {
			this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', 'The vote to reset the VM has won.')));
			this.VM.Reset();
		} else {
			this.clients.forEach((c) => c.sendMsg(cvm.guacEncode('chat', '', 'The vote to reset the VM has lost.')));
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
		var msg = cvm.guacEncode('vote', '1', (this.voteTime * 1000).toString(), count.yes.toString(), count.no.toString());
		if (client) client.sendMsg(msg);
		else this.clients.forEach((c) => c.sendMsg(msg));
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
