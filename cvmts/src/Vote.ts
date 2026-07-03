import EventEmitter from 'events';
import { User } from './User';
import { VoteType } from '@cvmts/collab-vm-1.2-binary-protocol';

export type VoteTally = {
	yes: Array<User>;
	no: Array<User>;
};

type VoteCooldownEntry = {
	timeRemaining: number;
	interval: NodeJS.Timeout;
};

export class VoteCooldownManager {
	private entries: Map<VoteType, VoteCooldownEntry>;

	constructor() {
		this.entries = new Map();
	}

	SetCooldown(type: VoteType, cooldown: number) {
		clearInterval(this.entries.get(type)?.interval);

		this.entries.set(type, {
			timeRemaining: cooldown,
			interval: setInterval(() => {
				let e = this.entries.get(type);
				if (!e) return;
				if (--e.timeRemaining < 1) {
					clearInterval(e.interval);
					this.entries.delete(type);
				}
			}, 1000)
		});
	}

	CheckCooldown(type: VoteType): number | null {
		return this.entries.get(type)?.timeRemaining ?? null;
	}
}

export class Vote extends EventEmitter {
	private voteType: VoteType;
	private voteTime: number;
	private voteIntentStr: string;
	private startedBy: User;
	private yesVotes: Array<User>;
	private noVotes: Array<User>;
	private voteTickInterval: NodeJS.Timeout;
	data: any;

	constructor(voteType: VoteType, voteTime: number, voteIntentStr: string, startedBy: User, data?: any) {
		super();
		this.voteType = voteType;
		this.voteTime = voteTime;
		this.voteIntentStr = voteIntentStr;
		this.startedBy = startedBy;
		this.yesVotes = [startedBy];
		this.noVotes = [];
		this.voteTickInterval = setInterval(() => {
			if (--this.voteTime < 1) {
				this.EndVote();
			}
		}, 1000);
		this.data = data;
	}

	GetVoteType() {
		return this.voteType;
	}

	GetVoteTime() {
		return this.voteTime;
	}

	HasEnded() {
		return this.voteTime < 1;
	}

	GetVoteIntentStr() {
		return this.voteIntentStr;
	}

	GetStartedBy() {
		return this.startedBy;
	}

	GetYesVotes() {
		return Array.from(this.yesVotes);
	}

	GetNoVotes() {
		return Array.from(this.noVotes);
	}

	AddVote(user: User, vote: boolean): boolean {
		if ((vote && this.yesVotes.indexOf(user) !== -1) || (!vote && this.noVotes.indexOf(user) !== -1)) {
			return false;
		}

		this.RemoveVote(user);
		if (vote) {
			this.yesVotes.push(user);
		} else {
			this.noVotes.push(user);
		}
		user.IP.hasVoted = true;
		return true;
	}

	RemoveVote(user: User): boolean {
		if (this.yesVotes.indexOf(user) !== -1) {
			this.yesVotes.splice(this.yesVotes.indexOf(user), 1);
			user.IP.hasVoted = false;
			return true;
		}
		if (this.noVotes.indexOf(user) !== -1) {
			this.noVotes.splice(this.noVotes.indexOf(user), 1);
			user.IP.hasVoted = false;
			return true;
		}
		return false;
	}

	GetVote(user: User): boolean | null {
		if (this.yesVotes.indexOf(user) !== -1) {
			return true;
		} else if (this.noVotes.indexOf(user) !== -1) {
			return false;
		} else {
			return null;
		}
	}

	EndVote(forceResult: boolean | null = null) {
		clearInterval(this.voteTickInterval);

		let result: boolean;
		if (forceResult !== null) {
			result = forceResult;
		} else {
			result = this.yesVotes.length >= this.noVotes.length;
		}

		for (let user of [...this.yesVotes, ...this.noVotes]) {
			user.IP.hasVoted = false;
		}

		this.emit('voteEnd', result);
	}
}
