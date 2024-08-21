import { Rank, User } from './User';

// We should probably put this in the binproto repository or something
enum UpgradeCapability {
	Binary = 'bin'
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

// Protocol handlers. This is implemented by a layer that wants to listen to CollabVM protocol messages.
export interface IProtocolHandlers {
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

	onAdminLogin(user: User, password: string): void;
	onAdminMonitor(user: User, node: string, command: string): void;

	onRename(user: User, newName: string|undefined): void;
	onChat(user: User, message: string): void;

	onKey(user: User, keysym: number, pressed: boolean): void;
	onMouse(user: User, x: number, y: number, buttonMask: number): void;
}

// Abstracts away all of the CollabVM protocol details
export interface IProtocol {
	init(u: User): void;

	// Sets handler object.
	setHandler(handlers: IProtocolHandlers): void;

	// Parses a single CollabVM protocol message and fires the given handler.
	// This function does not catch any thrown errors; it is the caller's responsibility
	// to handle errors. It should, however, catch invalid parameters without failing.
	processMessage(buffer: Buffer): boolean;

	// Senders

	sendNop(): void;
	sendSync(now: number): void;

	sendAuth(authServer: string): void;

	sendConnectFailResponse(): void;
	sendConnectOKResponse(votes: boolean): void;

	sendLoginResponse(ok: boolean, message: string | undefined): void;

	sendChatMessage(username: '' | string, message: string): void;
	sendChatHistoryMessage(history: ProtocolChatHistory[]): void;

	sendAddUser(users: ProtocolAddUser[]): void;
	sendRemUser(users: string[]): void;

	sendListResponse(list: ListEntry[]): void;

	sendScreenResize(width: number, height: number): void;

	// Sends a rectangle update to the user.
	sendScreenUpdate(rect: ScreenRect): void;
}

// Holds protocol factories.
export class ProtocolManager {
	private protocols = new Map<String, () => IProtocol>();

	// Registers a protocol with the given name.
	registerProtocol(name: string, protocolFactory: () => IProtocol) {
		if (!this.protocols.has(name)) this.protocols.set(name, protocolFactory);
	}

	// Creates an instance of a given protocol for a user.
	createProtocol(name: string, user: User): IProtocol {
		if (!this.protocols.has(name)) throw new Error(`ProtocolManager does not have protocol \"${name}\"`);

		let factory = this.protocols.get(name)!;
		let proto = factory();
		proto.init(user);
		return proto;
	}
}

/// Global protocol manager
export let TheProtocolManager = new ProtocolManager();
