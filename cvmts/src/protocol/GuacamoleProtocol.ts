import pino from 'pino';
import { IProtocol, IProtocolHandlers, ListEntry, ProtocolAddUser, ProtocolBase, ProtocolChatHistory, ProtocolFlag, ProtocolRenameStatus, ProtocolUpgradeCapability, ScreenRect } from './Protocol.js';
import { Rank, User } from '../User.js';

import * as cvm from '@cvmts/cvm-rs';

// CollabVM protocol implementation for Guacamole.
export class GuacamoleProtocol extends ProtocolBase implements IProtocol {
	private logger = pino({
		name: 'CVMTS.GuacamoleProtocol'
	});

	private __processMessage_admin(decodedElements: string[]): boolean {
		switch (decodedElements[1]) {
			case '2':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminLogin(this.user!, decodedElements[2]);
				break;
			case '5':
				if (decodedElements.length !== 4) return false;
				this.handlers?.onAdminMonitor(this.user!, decodedElements[2], decodedElements[3]);
				break;
			case '8':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminRestore(this.user!, decodedElements[2]);
				break;
			case '10':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminReboot(this.user!, decodedElements[2]);
				break;
			case '12':
				if (decodedElements.length < 3) return false;
				this.handlers?.onAdminBanUser(this.user!, decodedElements[2]);
			case '13':
				{
					if (decodedElements.length !== 3) return false;
					let choice = parseInt(decodedElements[2]);
					if (choice == undefined) return false;
					this.handlers?.onAdminForceVote(this.user!, choice);
				}
				break;
			case '14':
				{
					if (decodedElements.length !== 4) return false;
					let temporary = true;
					if (decodedElements[3] == '0') temporary = true;
					else if (decodedElements[3] == '1') temporary = false;
					else return false;
					this.handlers?.onAdminMuteUser(this.user!, decodedElements[2], temporary);
				}
				break;
			case '15':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminKickUser(this.user!, decodedElements[2]);
				break;
			case '16':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminEndTurn(this.user!, decodedElements[2]);
				break;
			case '17':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminClearQueue(this.user!, decodedElements[2]);
				break;
			case '18':
				if (decodedElements.length !== 4) return false;
				this.handlers?.onAdminRename(this.user!, decodedElements[2], decodedElements[3]);
				break;
			case '19':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminGetIP(this.user!, decodedElements[2]);
				break;
			case '20':
				this.handlers?.onAdminBypassTurn(this.user!);
				break;
			case '21':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminRawMessage(this.user!, decodedElements[2]);
				break;
			case '22':
				{
					// Toggle turns
					if (decodedElements.length !== 3) return false;
					let enabled = true;
					if (decodedElements[2] == '0') enabled = false;
					else if (decodedElements[2] == '1') enabled = true;
					else return false;
					this.handlers?.onAdminToggleTurns(this.user!, enabled);
				}
				break;
			case '23':
				this.handlers?.onAdminIndefiniteTurn(this.user!);
				break;
			case '24':
				{
					if (decodedElements.length !== 3) return false;
					let show = true;
					if (decodedElements[2] == '0') show = false;
					else if (decodedElements[2] == '1') show = true;
					else return false;
					this.handlers?.onAdminHideScreen(this.user!, show);
				}
				break;
			case '25':
				if (decodedElements.length !== 3) return false;
				this.handlers?.onAdminSystemMessage(this.user!, decodedElements[2]);
				break;
		}
		return true;
	}

	processMessage(buffer: Buffer): boolean {
		let decodedElements = cvm.guacDecode(buffer.toString('utf-8'));
		if (decodedElements.length < 1) return false;

		// The first element is the "opcode".
		switch (decodedElements[0]) {
			case 'nop':
				this.handlers?.onNop(this.user!);
				break;
			case 'cap':
				if (decodedElements.length < 2) return false;
				this.handlers?.onCapabilityUpgrade(this.user!, decodedElements.slice(1));
				break;
			case 'login':
				if (decodedElements.length !== 2) return false;
				this.handlers?.onLogin(this.user!, decodedElements[1]);
				break;
			case 'noflag':
				this.handlers?.onNoFlag(this.user!);
				break;
			case 'list':
				this.handlers?.onList(this.user!);
				break;
			case 'connect':
				if (decodedElements.length !== 2) return false;
				this.handlers?.onConnect(this.user!, decodedElements[1]);
				break;
			case 'view':
				{
					if (decodedElements.length !== 3) return false;
					let viewMode = parseInt(decodedElements[2]);
					if (viewMode == undefined) return false;

					this.handlers?.onView(this.user!, decodedElements[1], viewMode);
				}
				break;
			case 'rename':
				this.handlers?.onRename(this.user!, decodedElements[1]);
				break;
			case 'chat':
				if (decodedElements.length !== 2) return false;
				this.handlers?.onChat(this.user!, decodedElements[1]);
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

				this.handlers?.onTurnRequest(this.user!, forfeit);
				break;
			case 'mouse':
				if (decodedElements.length !== 4) return false;

				let x = parseInt(decodedElements[1]);
				let y = parseInt(decodedElements[2]);
				let mask = parseInt(decodedElements[3]);
				if (x === undefined || y === undefined || mask === undefined) return false;

				this.handlers?.onMouse(this.user!, x, y, mask);
				break;
			case 'key':
				if (decodedElements.length !== 3) return false;
				var keysym = parseInt(decodedElements[1]);
				var down = parseInt(decodedElements[2]);
				if (keysym === undefined || (down !== 0 && down !== 1)) return false;
				this.handlers?.onKey(this.user!, keysym, down === 1);
				break;
			case 'vote':
				if (decodedElements.length !== 2) return false;
				let choice = parseInt(decodedElements[1]);
				if (choice == undefined) return false;
				this.handlers?.onVote(this.user!, choice);
				break;

			case 'admin':
				if (decodedElements.length < 2) return false;
				return this.__processMessage_admin(decodedElements);
		}

		return true;
	}

	// Senders

	sendAuth(authServer: string): void {
		this.user?.sendMsg(cvm.guacEncode('auth', authServer));
	}

	sendNop(): void {
		this.user?.sendMsg(cvm.guacEncode('nop'));
	}

	sendSync(now: number): void {
		this.user?.sendMsg(cvm.guacEncode('sync', now.toString()));
	}

	sendCapabilities(caps: ProtocolUpgradeCapability[]): void {
		let arr = ['cap', ...caps];
		this?.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendConnectFailResponse(): void {
		this.user?.sendMsg(cvm.guacEncode('connect', '0'));
	}

	sendConnectOKResponse(votes: boolean): void {
		this.user?.sendMsg(cvm.guacEncode('connect', '1', '1', votes ? '1' : '0', '0'));
	}

	sendLoginResponse(ok: boolean, message: string | undefined): void {
		if (ok) {
			this.user?.sendMsg(cvm.guacEncode('login', '1'));
			return;
		} else {
			this.user?.sendMsg(cvm.guacEncode('login', '0', message!));
		}
	}

	sendAdminLoginResponse(ok: boolean, modPerms: number | undefined): void {
		if (ok) {
			if (modPerms == undefined) {
				this.user?.sendMsg(cvm.guacEncode('admin', '0', '1'));
			} else {
				this.user?.sendMsg(cvm.guacEncode('admin', '0', '3', modPerms.toString()));
			}
		} else {
			this.user?.sendMsg(cvm.guacEncode('admin', '0', '0'));
		}
	}

	sendAdminMonitorResponse(output: string): void {
		this.user?.sendMsg(cvm.guacEncode('admin', '2', output));
	}

	sendAdminIPResponse(username: string, ip: string): void {
		this.user?.sendMsg(cvm.guacEncode('admin', '19', username, ip));
	}

	sendChatMessage(username: string, message: string): void {
		this.user?.sendMsg(cvm.guacEncode('chat', username, message));
	}

	sendChatHistoryMessage(history: ProtocolChatHistory[]): void {
		let arr = ['chat'];
		for (let a of history) {
			arr.push(a.user, a.msg);
		}

		this.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendAddUser(users: ProtocolAddUser[]): void {
		let arr = ['adduser', users.length.toString()];
		for (let user of users) {
			arr.push(user.username);
			arr.push(user.rank.toString());
		}

		this.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendRemUser(users: string[]): void {
		let arr = ['remuser', users.length.toString()];

		for (let user of users) {
			arr.push(user);
		}

		this.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendFlag(flag: ProtocolFlag[]): void {
		// Basically this does the same as the above manual for of things
		// but in one line of code
		let arr = ['flag', ...flag.flatMap((flag) => [flag.username, flag.countryCode])];
		this.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendSelfRename(status: ProtocolRenameStatus, newUsername: string, rank: Rank): void {
		this.user?.sendMsg(cvm.guacEncode('rename', '0', status.toString(), newUsername, rank.toString()));
	}

	sendRename(oldUsername: string, newUsername: string, rank: Rank): void {
		this.user?.sendMsg(cvm.guacEncode('rename', '1', oldUsername, newUsername, rank.toString()));
	}

	sendListResponse(list: ListEntry[]): void {
		let arr = ['list'];
		for (let node of list) {
			arr.push(node.id);
			arr.push(node.name);
			arr.push(node.thumbnail.toString('base64'));
		}

		this.user?.sendMsg(cvm.guacEncode(...arr));
	}

	sendVoteStarted(): void {
		this.user?.sendMsg(cvm.guacEncode('vote', '0'));
	}

	sendVoteStats(msLeft: number, nrYes: number, nrNo: number): void {
		this.user?.sendMsg(cvm.guacEncode('vote', '1', msLeft.toString(), nrYes.toString(), nrNo.toString()));
	}

	sendVoteEnded(): void {
		this.user?.sendMsg(cvm.guacEncode('vote', '2'));
	}

	sendVoteCooldown(ms: number): void {
		this.user?.sendMsg(cvm.guacEncode('vote', '3', ms.toString()));
	}

	private getTurnQueueBase(turnTime: number, users: string[]): string[] {
		return ['turn', turnTime.toString(), users.length.toString(), ...users];
	}

	sendTurnQueue(turnTime: number, users: string[]): void {
		this.user?.sendMsg(cvm.guacEncode(...this.getTurnQueueBase(turnTime, users)));
	}

	sendTurnQueueWaiting(turnTime: number, users: string[], waitTime: number): void {
		let queue = this.getTurnQueueBase(turnTime, users);
		queue.push(waitTime.toString());
		this.user?.sendMsg(cvm.guacEncode(...queue));
	}

	sendScreenResize(width: number, height: number): void {
		this.user?.sendMsg(cvm.guacEncode('size', '0', width.toString(), height.toString()));
	}

	sendScreenUpdate(rect: ScreenRect): void {
		this.user?.sendMsg(cvm.guacEncode('png', '0', '0', rect.x.toString(), rect.y.toString(), rect.data.toString('base64')));
		this.sendSync(Date.now());
	}
}
