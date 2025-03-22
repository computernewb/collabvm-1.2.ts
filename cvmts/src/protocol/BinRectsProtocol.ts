import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from '@cvmts/collab-vm-1.2-binary-protocol';
import { GuacamoleProtocol } from './GuacamoleProtocol.js';

import { ScreenRect } from './Protocol';

export class BinRectsProtocol extends GuacamoleProtocol {
	sendScreenUpdate(rect: ScreenRect): void {
		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.rect,
			rect: rect
		};

		this.user?.socket.sendBinary(msgpack.encode(bmsg));
	}
}
