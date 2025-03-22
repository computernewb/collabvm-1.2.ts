import { IProtocol } from "./Protocol";
import { User } from "../User";

// The protocol manager. Holds protocol factories, and provides the ability
// to create a protocol by name. Avoids direct dependency on a given list of protocols,
// and allows (relatively simple) expansion.
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
