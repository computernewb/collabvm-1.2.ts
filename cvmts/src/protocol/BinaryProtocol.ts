import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from '@cvmts/collab-vm-1.2-binary-protocol';
import { GuacamoleProtocol } from './GuacamoleProtocol.js';

import { ScreenRect, AudioFormat } from './Protocol';
import { User } from '../User.js';

export class BinaryProtocol extends GuacamoleProtocol {
	sendScreenUpdate(user: User, rect: ScreenRect): void {
		const bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.rect,
			rect: rect
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	// Relying on AudioFormat and CollabVMAudioFormatMessage being the same... eh
	sendAudioFormat(user: User, format: AudioFormat) {
		const bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.audioFormat,
			audioFormat: format
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendAudio(user: User, data: Buffer): void {
		const bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.audio,
			audio: { data }
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}
}
