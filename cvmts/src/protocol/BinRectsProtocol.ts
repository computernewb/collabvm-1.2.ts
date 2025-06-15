import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from '@cvmts/collab-vm-1.2-binary-protocol';
import { GuacamoleProtocol } from './GuacamoleProtocol.js';

import { ScreenRect } from './Protocol';
import { User } from '../User.js';

export class BinRectsProtocol extends GuacamoleProtocol {
	sendScreenUpdate(user: User, rect: ScreenRect): void {
		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.rect,
			rect: rect
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}
}
