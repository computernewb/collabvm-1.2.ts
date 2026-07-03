import Queue from 'mnemonist/queue.js';
import * as Utilities from './Utilities.js';
import { User } from './User.js';
import IConfig from './IConfig.js';
import { Timer } from './util/timer.js';

export enum TurnState {
	Inactive = 0, // default state, no one is turning

	Active, // turn queue is active. can only go to Active_OneUser or Inactive states
	Active_OneUser, // active, but paused because only one user is active
	Active_Paused // active, but explicitly paused by an admin or moderator
}

export enum SpecialTurnTimes {
	OneUser = 2147483647,
	Paused = 2147483646
}

export interface TurnQueueEntry {
	user: User;
	time: number; // time left

	waiting: boolean;
	waitingTime?: number; // set if waiting == true
}

export type TurnQueue = TurnQueueEntry[];

export class TurnController {
	private queue: Queue<User>;
	private state: TurnState = TurnState.Inactive;
	private turnTimer: Timer;
	private updateCb: (state: TurnQueue) => void;

	constructor(config: IConfig, updateCb: (state: TurnQueue) => void) {
		this.queue = new Queue();
		this.turnTimer = new Timer(config.collabvm.turnTime, this.onTurnTimerElapsed.bind(this));
		this.updateCb = updateCb;
	}

	private onTurnTimerElapsed() {
		this.queue.dequeue();
		this.updateStateMachine();
	}

	private transitionToState(newState: TurnState) {
		if (this.state !== newState) {
			let fromState = this.state;
			this.state = newState;
			this.onTurnStateChange(fromState);
		}
	}

	private onTurnStateChange(fromState: TurnState) {
		switch (this.state) {
			case TurnState.Inactive: {
				if (fromState == TurnState.Active || fromState == TurnState.Active_OneUser) {
					// disarm the timer
					this.turnTimer.disarm();
				}
			}

			case TurnState.Active_OneUser:
				{
					// We can transition into this state from Active.
					if (fromState == TurnState.Active) {
						if (this.turnTimer.wasArmed()) this.turnTimer.pause();
					}
				}
				break;

			case TurnState.Active:
				{
					// We can only enter here via Active_OneUser
					// and Active_Paused states.

					// arm or unpause the turn timer depending on what state we entrered from
					if (fromState == TurnState.Active_Paused && this.turnTimer.wasArmed()) this.turnTimer.unpause();
					else {
						// re-arm the timer
						this.turnTimer.arm();
					}
				}
				break;

			case TurnState.Active_Paused:
				{
					// We don't need to pause the turn timer if it was never armed or we entered
					// from an inactive queue.
					if (fromState !== TurnState.Inactive) {
						if (this.turnTimer.wasArmed()) this.turnTimer.pause();
					}
				}
				break;
		}
	}

	private updateStateMachine() {
		if (!this.paused()) {
			// this is kind of ugly but basically this transitions into the correct
			// state depending on the queue.
			if (this.queue.size > 1) {
				this.transitionToState(TurnState.Active);
			} else if (this.queue.size == 1) {
				this.transitionToState(TurnState.Active_OneUser);
			} else if (this.queue.size == 0) {
				this.transitionToState(TurnState.Inactive);
			}
		}

		// tell upstream layer about turn queue update
		this.updateCb(this.getTurnInfo());
	}

	userInQueue(user: User) {
		return Utilities.iteratorHasItem(this.queue.values(), user);
	}

	addUser(user: User) {
		if (this.userInQueue(user)) return;

		// Disallow entering the queue when it's paused
		if (this.state == TurnState.Active_Paused) return;

		this.queue.enqueue(user);
		this.updateStateMachine();
	}

	removeUser(user: User) {
		// you jerkass
		if (!this.userInQueue(user)) return;

		if (this.queue.peek() == user) {
			this.endCurrentTurn();
			return;
		} else {
			if (this.paused()) return;

			// bad!!!!! but this should hopefully be one of the last times we need to do this!
			// other case is bypass turn
			this.queue = Queue.from(this.queue.toArray().filter((c) => c !== user));
		}

		this.updateStateMachine();
	}

	bypassTurn(user: User) {
		this.queue = Queue.from([user, ...this.queue.toArray().filter((c) => c !== user)]);
		this.updateStateMachine();
	}

	endCurrentTurn() {
		this.queue.dequeue();
		this.updateStateMachine();
	}

	clearTurns() {
		this.queue.clear();
		this.updateStateMachine();
	}

	pauseQueue() {
		if (!this.paused()) {
			this.transitionToState(TurnState.Active_Paused);
			this.updateStateMachine();
		}
	}

	paused() {
		return this.state == TurnState.Active_Paused;
	}

	unpauseQueue() {
		if (this.paused()) {
			this.transitionToState(TurnState.Active);
			this.updateStateMachine();
		}
	}

	usersWithSameIpInQueue(user: User) {
		// better than the old way even though it's a bit verbose since this
		// doesn't new a whole brand new array each time it's called :)
		let count = 0;
		this.queue.forEach((iteratedUser: User) => {
			if (iteratedUser.IP.address == user.IP.address) count++;
		});
		return count;
	}

	userIsActive(user: User) {
		if (this.state == TurnState.Inactive) return false;
		return this.queue.peek() === user;
	}

	getTurnInfo(): TurnQueue {
		switch (this.state) {
			case TurnState.Active_OneUser: {
				let user = this.queue.peek()!;
				return [
					{
						user: user,
						time: SpecialTurnTimes.OneUser,
						waiting: false
					}
				];
			}

			case TurnState.Active: {
				let remainingTurnTimeMs = this.turnTimer.getRemaining() * 1000;
				let users: TurnQueueEntry[] = [];
				let currentTurningUser = this.queue.peek()!;

				users.push({
					user: currentTurningUser,
					time: remainingTurnTimeMs,
					waiting: false
				});

				this.queue.forEach((user: User, queueIndex: number) => {
					if (user == currentTurningUser) return;
					users.push({
						user: user,
						// position specific time
						time: remainingTurnTimeMs,
						waiting: true,
						waitingTime: (queueIndex - 1) * (this.turnTimer.getInterval() * 1000)
					});
				});

				return users;
			}

			case TurnState.Active_Paused: {
				let users: TurnQueueEntry[] = [];
				if (this.queue.size == 0) {
					return users;
				} else {
					let currentTurningUser = this.queue.peek()!;

					users.push({
						user: currentTurningUser,
						time: SpecialTurnTimes.Paused,
						waiting: false
					});

					this.queue.forEach((user: User, queueIndex: number) => {
						if (user == currentTurningUser) return;
						users.push({
							user: user,
							time: SpecialTurnTimes.Paused,
							waiting: true,
							waitingTime: SpecialTurnTimes.Paused
						});
					});
				}

				return users;
			}

			// In this case we can assume no one is in the list.
			case TurnState.Inactive:
			default:
				return [];
		}
	}
}
