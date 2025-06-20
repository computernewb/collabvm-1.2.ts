import { Rank, User } from '../User';

// We should probably put this in the binproto repository or something
export enum ProtocolUpgradeCapability {
	BinRects = 'bin',
	ExtendedList = 'xlst'
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
	userCount: number;
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
	// Protocol implementation stuff

	// Parses a single message and fires the given handler with deserialized arguments.
	// This function does not catch any thrown errors; it is the caller's responsibility
	// to handle errors. It should, however, catch invalid parameters without failing.
	//
	// This function will perform conversion to text if it is required.
	processMessage(user: User, handler: IProtocolMessageHandler, buffer: Buffer): boolean;

	// Senders

	sendNop(user: User): void;
	sendSync(user: User, now: number): void;

	sendAuth(user: User, authServer: string): void;

	sendCapabilities(user: User, caps: ProtocolUpgradeCapability[]): void;

	sendConnectFailResponse(user: User): void;
	sendConnectOKResponse(user: User, votes: boolean): void;

	sendLoginResponse(user: User, ok: boolean, message: string | undefined): void;

	sendAdminLoginResponse(user: User, ok: boolean, modPerms: number | undefined): void;
	sendAdminMonitorResponse(user: User, output: string): void;
	sendAdminIPResponse(user: User, username: string, ip: string): void;

	sendChatMessage(user: User, username: '' | string, message: string): void;
	sendChatHistoryMessage(user: User, history: ProtocolChatHistory[]): void;

	sendAddUser(user: User, users: ProtocolAddUser[]): void;
	sendRemUser(user: User, users: string[]): void;
	sendFlag(user: User, flag: ProtocolFlag[]): void;

	sendSelfRename(user: User, status: ProtocolRenameStatus, newUsername: string, rank: Rank): void;
	sendRename(user: User, oldUsername: string, newUsername: string, rank: Rank): void;

	sendListResponse(user: User, list: ListEntry[]): void;

	sendTurnQueue(user: User, turnTime: number, users: string[]): void;
	sendTurnQueueWaiting(user: User, turnTime: number, users: string[], waitTime: number): void;

	sendVoteStarted(user: User): void;
	sendVoteStats(user: User, msLeft: number, nrYes: number, nrNo: number): void;
	sendVoteEnded(user: User): void;
	sendVoteCooldown(user: User, ms: number): void;

	sendScreenResize(user: User, width: number, height: number): void;

	// Sends a rectangle update to the user.
	sendScreenUpdate(user: User, rect: ScreenRect): void;
}
