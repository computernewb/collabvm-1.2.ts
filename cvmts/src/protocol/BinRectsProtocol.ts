import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType, VoteType } from '@cvmts/collab-vm-1.2-binary-protocol';
import { GuacamoleProtocol } from './GuacamoleProtocol.js';

import { IProtocolMessageHandler, ScreenRect } from './Protocol';
import { User } from '../User.js';

export class BinRectsProtocol extends GuacamoleProtocol {
	processMessage(user: User, handler: IProtocolMessageHandler, buffer: Buffer, binary: boolean): boolean {
		if (binary) {
			let msg: CollabVMProtocolMessage;
			try {
				msg = msgpack.unpack(buffer);
			} catch (e) {
				return false;
			}

			switch (msg.type) {
				case CollabVMProtocolMessageType.iaosChangeMedia: {
					if (!msg.iaosChangeMedia?.id) {
						return false;
					}

					handler.onIaosChangeMedia(user, msg.iaosChangeMedia.id);
					return true;
				}
				case CollabVMProtocolMessageType.iaosEjectMedia: {
					if (!msg.iaosEjectMedia?.kind) {
						return false;
					}

					handler.onIaosEjectMedia(user, msg.iaosEjectMedia.kind);
					return true;
				}
				case CollabVMProtocolMessageType.voteStart: {
					if (!msg.voteStart?.voteType) {
						return false;
					}
					handler.onStartVote(user, msg.voteStart.voteType);
				}
				default: {
					return false;
				}
			}
		} else {
			return super.processMessage(user, handler, buffer, binary);
		}
	}

	sendScreenUpdate(user: User, rect: ScreenRect): void {
		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.rect,
			rect: rect
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendIaosAdvertisement(user: User, apiUrl: string, mediaKindSupported: Array<string>): void {
		if (!user.Capabilities.iaos) {
			super.sendIaosAdvertisement(user, apiUrl, mediaKindSupported);
			return;
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.iaosAdvertisement,
			iaosAdvertisement: {
				api: apiUrl,
				mediaKindSupported: mediaKindSupported
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendIaosMediaChanged(user: User, changedBy: User, mediaKind: string, ejected: boolean, mediaName?: string): void {
		if (!user.Capabilities.iaos) {
			super.sendIaosMediaChanged(user, changedBy, mediaKind, ejected, mediaName);
			return;
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.iaosMediaChanged,
			iaosMediaChanged: {
				username: changedBy.username,
				mediaKind,
				ejected,
				mediaName
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendVoteStats(user: User, started: boolean, startedBy: User, voteType: string, intentStr: string, voteTime: number, yesVotes: Array<User>, noVotes: Array<User>, data?: any): void {
		if (!user.Capabilities.votex) {
			super.sendVoteStats(user, started, startedBy, voteType, intentStr, voteTime, yesVotes, noVotes, data);
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.voteStatus,
			voteStatus: {
				started,
				voteType,
				voteIntentStr: intentStr,
				data,
				voteTime,
				startedByUser: startedBy.username,
				yesVotes: yesVotes.map((u) => u.username),
				noVotes: noVotes.map((u) => u.username)
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendVoteEnded(user: User, voteType: string, intentStr: string, voteSucceeded: boolean): void {
		if (!user.Capabilities.votex) {
			super.sendVoteEnded(user, voteType, intentStr, voteSucceeded);
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.voteEnded,
			voteEnded: {
				voteType,
				voteIntentStr: intentStr,
				voteSucceeded
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendVoteStartFailed(user: User, voteType: string, error: string, cooldown?: number): void {
		if (!user.Capabilities.votex) {
			super.sendVoteStartFailed(user, voteType, error, cooldown);
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.voteStartFailed,
			voteStartFailed: {
				voteType,
				error,
				cooldownTime: cooldown
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}

	sendVotesEnabled(user: User, votesEnabled: Array<VoteType>): void {
		if (!user.Capabilities.votex) {
			return;
		}

		let bmsg: CollabVMProtocolMessage = {
			type: CollabVMProtocolMessageType.votesEnabled,
			votesEnabled: {
				votesEnabled
			}
		};

		user.socket.sendBinary(msgpack.encode(bmsg));
	}
}
