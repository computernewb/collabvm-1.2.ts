import { Rank, User } from '../User';

// We should probably put this in the binproto repository or something
export enum ProtocolUpgradeCapability {
	BinRects = 'bin'
}

export enum ProtocolRenameStatus {
	Ok = 0,
	UsernameTaken = 1,
	UsernameInvalid = 2,
	UsernameNotAllowed = 3
}

export interface ScreenRect {
	x: number;
	y: number;
	data: Buffer;
}

export interface ListEntry {
	id: string;
	name: string;
	thumbnail: Buffer;
}

export interface ProtocolChatHistory {
	user: string;
	msg: string;
}

export interface ProtocolAddUser {
	username: string;
	rank: Rank;
}

export interface ProtocolFlag {
	username: string;
	countryCode: string;
}

// Protocol handlers. This is implemented by a layer that wants to listen to CollabVM protocol messages.
export interface IProtocolMessageHandler {
	onNop(user: User): void;

	onNoFlag(user: User): void;

	// Called when the client requests a capability upgrade
	onCapabilityUpgrade(user: User, capability: Array<String>): boolean;

	onLogin(user: User, token: string): void;

	// Called on turn request
	onTurnRequest(user: User, forfeit: boolean): void;

	onVote(user: User, choice: number): void;

	onList(user: User): void;
	onConnect(user: User, node: string): void;
	onView(user: User, node: string, viewMode: number): void;

	onAudioMute(user: User): void; // user requests an audio mute/unmute

	// Admin handlers
	onAdminLogin(user: User, password: string): void;
	onAdminMonitor(user: User, node: string, command: string): void;
	onAdminRestore(user: User, node: string): void;
	onAdminReboot(user: User, node: string): void;
	onAdminBanUser(user: User, username: string): void;
	onAdminForceVote(user: User, choice: number): void;
	onAdminMuteUser(user: User, username: string, temporary: boolean): void;
	onAdminKickUser(user: User, username: string): void;
	onAdminEndTurn(user: User, username: string): void;
	onAdminClearQueue(user: User, node: string): void;
	onAdminRename(user: User, target: string, newName: string): void;
	onAdminGetIP(user: User, username: string): void;
	onAdminBypassTurn(user: User): void;
	onAdminRawMessage(user: User, message: string): void;
	onAdminToggleTurns(user: User, enabled: boolean): void;
	onAdminIndefiniteTurn(user: User): void;
	onAdminHideScreen(user: User, show: boolean): void;
	onAdminSystemMessage(user: User, message: string): void;

	onRename(user: User, newName: string | undefined): void;
	onChat(user: User, message: string): void;

	onKey(user: User, keysym: number, pressed: boolean): void;
	onMouse(user: User, x: number, y: number, buttonMask: number): void;
}

// Abstracts away all of the protocol details from the CollabVM server,
// allowing it to be protocol-independent (as long as the client and server
// are able to speak the same protocol.)
export interface IProtocol {
	// don't implement this yourself, extend from ProtocolBase
	init(u: User): void;
	dispose(): void;

	// Sets handler object.
	setHandler(handlers: IProtocolMessageHandler): void;

	// Protocol implementation stuff

	// Parses a single message and fires the given handler with deserialized arguments.
	// This function does not catch any thrown errors; it is the caller's responsibility
	// to handle errors. It should, however, catch invalid parameters without failing.
	//
	// This function will perform conversion to text if it is required.
	processMessage(buffer: Buffer): boolean;

	// Senders

	sendNop(): void;
	sendSync(now: number): void;

	sendAuth(authServer: string): void;

	sendCapabilities(caps: ProtocolUpgradeCapability[]): void;

	sendConnectFailResponse(): void;
	sendConnectOKResponse(votes: boolean): void;

	sendLoginResponse(ok: boolean, message: string | undefined): void;

	sendAdminLoginResponse(ok: boolean, modPerms: number | undefined): void;
	sendAdminMonitorResponse(output: string): void;
	sendAdminIPResponse(username: string, ip: string): void;

	sendChatMessage(username: '' | string, message: string): void;
	sendChatHistoryMessage(history: ProtocolChatHistory[]): void;

	sendAddUser(users: ProtocolAddUser[]): void;
	sendRemUser(users: string[]): void;
	sendFlag(flag: ProtocolFlag[]): void;

	sendSelfRename(status: ProtocolRenameStatus, newUsername: string, rank: Rank): void;
	sendRename(oldUsername: string, newUsername: string, rank: Rank): void;

	sendListResponse(list: ListEntry[]): void;

	sendTurnQueue(turnTime: number, users: string[]): void;
	sendTurnQueueWaiting(turnTime: number, users: string[], waitTime: number): void;

	sendVoteStarted(): void;
	sendVoteStats(msLeft: number, nrYes: number, nrNo: number): void;
	sendVoteEnded(): void;
	sendVoteCooldown(ms: number): void;

	sendScreenResize(width: number, height: number): void;

	// Sends a rectangle update to the user.
	sendScreenUpdate(rect: ScreenRect): void;

	// Sends an opus packet to the user.
	sendAudioOpus(data: Buffer): void;
}

// Base mixin for all concrete protocols to use. Inherit from this!
export class ProtocolBase {
	protected handlers: IProtocolMessageHandler | null = null;
	protected user: User | null = null;

	init(u: User): void {
		this.user = u;
	}

	dispose(): void {
		this.user = null;
		this.handlers = null;
	}

	setHandler(handlers: IProtocolMessageHandler): void {
		this.handlers = handlers;
	}
}
