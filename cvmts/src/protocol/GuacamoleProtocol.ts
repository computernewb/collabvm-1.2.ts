import { IProtocol, IProtocolMessageHandler, ListEntry, ProtocolAddUser, ProtocolChatHistory, ProtocolFlag, ProtocolRenameStatus, ProtocolUpgradeCapability, ScreenRect } from './Protocol.js';
import { Rank, User } from '../User.js';

import * as cvm from '@cvmts/cvm-rs';

// CollabVM protocol implementation for Guacamole.
export class GuacamoleProtocol implements IProtocol {
	private __processMessage_admin(user: User, handler: IProtocolMessageHandler, decodedElements: string[]): boolean {
		switch (decodedElements[1]) {
			case '2':
				if (decodedElements.length !== 3) return false;
				handler.onAdminLogin(user, decodedElements[2]);
				break;
			case '5':
				if (decodedElements.length !== 4) return false;
				handler.onAdminMonitor(user, decodedElements[2], decodedElements[3]);
				break;
			case '8':
				if (decodedElements.length !== 3) return false;
				handler.onAdminRestore(user, decodedElements[2]);
				break;
			case '10':
				if (decodedElements.length !== 3) return false;
				handler.onAdminReboot(user, decodedElements[2]);
				break;
			case '12':
				if (decodedElements.length < 3) return false;
				handler.onAdminBanUser(user, decodedElements[2]);
			case '13':
				{
					if (decodedElements.length !== 3) return false;
					let choice = parseInt(decodedElements[2]);
					if (choice == undefined) return false;
					handler.onAdminForceVote(user, choice);
				}
				break;
			case '14':
				{
					if (decodedElements.length !== 4) return false;
					let temporary = true;
					if (decodedElements[3] == '0') temporary = true;
					else if (decodedElements[3] == '1') temporary = false;
					else return false;
					handler.onAdminMuteUser(user, decodedElements[2], temporary);
				}
				break;
			case '15':
				if (decodedElements.length !== 3) return false;
				handler.onAdminKickUser(user, decodedElements[2]);
				break;
			case '16':
				if (decodedElements.length !== 3) return false;
				handler.onAdminEndTurn(user, decodedElements[2]);
				break;
			case '17':
				if (decodedElements.length !== 3) return false;
				handler.onAdminClearQueue(user, decodedElements[2]);
				break;
			case '18':
				if (decodedElements.length !== 4) return false;
				handler.onAdminRename(user, decodedElements[2], decodedElements[3]);
				break;
			case '19':
				if (decodedElements.length !== 3) return false;
				handler.onAdminGetIP(user, decodedElements[2]);
				break;
			case '20':
				handler.onAdminBypassTurn(user);
				break;
			case '21':
				if (decodedElements.length !== 3) return false;
				handler.onAdminRawMessage(user, decodedElements[2]);
				break;
			case '22':
				{
					// Toggle turns
					if (decodedElements.length !== 3) return false;
					let enabled = true;
					if (decodedElements[2] == '0') enabled = false;
					else if (decodedElements[2] == '1') enabled = true;
					else return false;
					handler.onAdminToggleTurns(user, enabled);
				}
				break;
			case '23':
				handler.onAdminIndefiniteTurn(user);
				break;
			case '24':
				{
					if (decodedElements.length !== 3) return false;
					let show = true;
					if (decodedElements[2] == '0') show = false;
					else if (decodedElements[2] == '1') show = true;
					else return false;
					handler.onAdminHideScreen(user, show);
				}
				break;
			case '25':
				if (decodedElements.length !== 3) return false;
				handler.onAdminSystemMessage(user, decodedElements[2]);
				break;
		}
		return true;
	}

	processMessage(user: User, handler: IProtocolMessageHandler, buffer: Buffer): boolean {
		let decodedElements = cvm.guacDecode(buffer.toString('utf-8'));
		if (decodedElements.length < 1) return false;

		// The first element is the "opcode".
		switch (decodedElements[0]) {
			case 'nop':
				handler.onNop(user);
				break;
			case 'cap':
				if (decodedElements.length < 2) return false;
				handler.onCapabilityUpgrade(user, decodedElements.slice(1));
				break;
			case 'login':
				if (decodedElements.length !== 2) return false;
				handler.onLogin(user, decodedElements[1]);
				break;
			case 'noflag':
				handler.onNoFlag(user);
				break;
			case 'list':
				handler.onList(user);
				break;
			case 'connect':
				if (decodedElements.length !== 2) return false;
				handler.onConnect(user, decodedElements[1]);
				break;
			case 'view':
				{
					if (decodedElements.length !== 3) return false;
					let viewMode = parseInt(decodedElements[2]);
					if (viewMode == undefined) return false;

					handler.onView(user, decodedElements[1], viewMode);
				}
				break;
			case 'rename':
				handler.onRename(user, decodedElements[1]);
				break;
			case 'chat':
				if (decodedElements.length !== 2) return false;
				handler.onChat(user, decodedElements[1]);
				break;
			case 'turn':
				let forfeit = false;
				if (decodedElements.length > 2) return false;
				if (decodedElements.length == 1) {
					forfeit = false;
				} else {
					if (decodedElements[1] == '0') forfeit = true;
					else if (decodedElements[1] == '1') forfeit = false;
				}

				handler.onTurnRequest(user, forfeit);
				break;
			case 'mouse':
				if (decodedElements.length !== 4) return false;

				let x = parseInt(decodedElements[1]);
				let y = parseInt(decodedElements[2]);
				let mask = parseInt(decodedElements[3]);
				if (x === undefined || y === undefined || mask === undefined) return false;

				handler.onMouse(user, x, y, mask);
				break;
			case 'key':
				if (decodedElements.length !== 3) return false;
				var keysym = parseInt(decodedElements[1]);
				var down = parseInt(decodedElements[2]);
				if (keysym === undefined || (down !== 0 && down !== 1)) return false;
				handler.onKey(user, keysym, down === 1);
				break;
			case 'vote':
				if (decodedElements.length !== 2) return false;
				let choice = parseInt(decodedElements[1]);
				if (choice == undefined) return false;
				handler.onVote(user, choice);
				break;

			case 'admin':
				if (decodedElements.length < 2) return false;
				return this.__processMessage_admin(user, handler, decodedElements);
		}

		return true;
	}

	// Senders

	sendAuth(user: User, authServer: string): void {
		user.sendMsg(cvm.guacEncode('auth', authServer));
	}

	sendNop(user: User): void {
		user.sendMsg(cvm.guacEncode('nop'));
	}

	sendSync(user: User, now: number): void {
		user.sendMsg(cvm.guacEncode('sync', now.toString()));
	}

	sendCapabilities(user: User, caps: ProtocolUpgradeCapability[]): void {
		let arr = ['cap', ...caps];
		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendConnectFailResponse(user: User): void {
		user.sendMsg(cvm.guacEncode('connect', '0'));
	}

	sendConnectOKResponse(user: User, votes: boolean): void {
		user.sendMsg(cvm.guacEncode('connect', '1', '1', votes ? '1' : '0', '0'));
	}

	sendLoginResponse(user: User, ok: boolean, message: string | undefined): void {
		if (ok) {
			user.sendMsg(cvm.guacEncode('login', '1'));
			return;
		} else {
			user.sendMsg(cvm.guacEncode('login', '0', message!));
		}
	}

	sendAdminLoginResponse(user: User, ok: boolean, modPerms: number | undefined): void {
		if (ok) {
			if (modPerms == undefined) {
				user.sendMsg(cvm.guacEncode('admin', '0', '1'));
			} else {
				user.sendMsg(cvm.guacEncode('admin', '0', '3', modPerms.toString()));
			}
		} else {
			user.sendMsg(cvm.guacEncode('admin', '0', '0'));
		}
	}

	sendAdminMonitorResponse(user: User, output: string): void {
		user.sendMsg(cvm.guacEncode('admin', '2', output));
	}

	sendAdminIPResponse(user: User, username: string, ip: string): void {
		user.sendMsg(cvm.guacEncode('admin', '19', username, ip));
	}

	sendChatMessage(user: User, username: string, message: string): void {
		user.sendMsg(cvm.guacEncode('chat', username, message));
	}

	sendChatHistoryMessage(user: User, history: ProtocolChatHistory[]): void {
		let arr = ['chat'];
		for (let a of history) {
			arr.push(a.user, a.msg);
		}

		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendAddUser(user: User, users: ProtocolAddUser[]): void {
		let arr = ['adduser', users.length.toString()];
		for (let user of users) {
			arr.push(user.username);
			arr.push(user.rank.toString());
		}

		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendRemUser(user: User, users: string[]): void {
		let arr = ['remuser', users.length.toString()];

		for (let user of users) {
			arr.push(user);
		}

		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendFlag(user: User, flag: ProtocolFlag[]): void {
		// Basically this does the same as the above manual for of things
		// but in one line of code
		let arr = ['flag', ...flag.flatMap((flag) => [flag.username, flag.countryCode])];
		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendSelfRename(user: User, status: ProtocolRenameStatus, newUsername: string, rank: Rank): void {
		user.sendMsg(cvm.guacEncode('rename', '0', status.toString(), newUsername));
	}

	sendRename(user: User, oldUsername: string, newUsername: string, rank: Rank): void {
		user.sendMsg(cvm.guacEncode('rename', '1', oldUsername, newUsername));
	}

	sendListResponse(user: User, list: ListEntry[]): void {
		let arr = ['list'];
		for (let node of list) {
			arr.push(node.id);
			arr.push(node.name);
			arr.push(node.thumbnail.toString('base64'));
		}

		user.sendMsg(cvm.guacEncode(...arr));
	}

	sendVoteStarted(user: User): void {
		user.sendMsg(cvm.guacEncode('vote', '0'));
	}

	sendVoteStats(user: User, msLeft: number, nrYes: number, nrNo: number): void {
		user.sendMsg(cvm.guacEncode('vote', '1', msLeft.toString(), nrYes.toString(), nrNo.toString()));
	}

	sendVoteEnded(user: User): void {
		user.sendMsg(cvm.guacEncode('vote', '2'));
	}

	sendVoteCooldown(user: User, ms: number): void {
		user.sendMsg(cvm.guacEncode('vote', '3', ms.toString()));
	}

	private getTurnQueueBase(turnTime: number, users: string[]): string[] {
		return ['turn', turnTime.toString(), users.length.toString(), ...users];
	}

	sendTurnQueue(user: User, turnTime: number, users: string[]): void {
		user.sendMsg(cvm.guacEncode(...this.getTurnQueueBase(turnTime, users)));
	}

	sendTurnQueueWaiting(user: User, turnTime: number, users: string[], waitTime: number): void {
		let queue = this.getTurnQueueBase(turnTime, users);
		queue.push(waitTime.toString());
		user.sendMsg(cvm.guacEncode(...queue));
	}

	sendScreenResize(user: User, width: number, height: number): void {
		user.sendMsg(cvm.guacEncode('size', '0', width.toString(), height.toString()));
	}

	sendScreenUpdate(user: User, rect: ScreenRect): void {
		user.sendMsg(cvm.guacEncode('png', '0', '0', rect.x.toString(), rect.y.toString(), rect.data.toString('base64')));
		this.sendSync(user, Date.now());
	}
}
