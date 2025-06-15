import { IProtocol } from './Protocol';
import { User } from '../User';

// The protocol manager.
// Holds protocols, and provides the ability to obtain them by name. 
//
// Avoids direct dependency on a given list of protocols,
// and allows (relatively simple) expansion of the supported protocols.
export class ProtocolManager {
	private protocols = new Map<String, IProtocol>();

	// Registers a protocol with the given name, creates it, and stores it for later use.
	registerProtocol(name: string, protocolFactory: () => IProtocol) {
		if (!this.protocols.has(name)) this.protocols.set(name, protocolFactory());
	}

	// Gets an instance of a protocol.
	getProtocol(name: string): IProtocol {
		let proto = this.protocols.get(name);
		if (proto == undefined) throw new Error(`ProtocolManager does not have protocol \"${name}\"`);
		return proto;
	}
}

/// Global protocol manager
export let TheProtocolManager = new ProtocolManager();
