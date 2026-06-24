export class Timer {
	private leftSeconds: number;
	private timerInterval?: NodeJS.Timeout;
	private intervalSeconds: number;
	private onElapsedCb : () => void;

	constructor(intervalSeconds: number, onElapsed: () => void) {
		this.leftSeconds = 0;
		this.intervalSeconds = intervalSeconds;
		this.onElapsedCb = onElapsed;
	}

	private removeInterval() {
		if(this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = undefined;
		}
	}

	private addInterval() {
		if(this.timerInterval)
			this.removeInterval();
		this.timerInterval = setInterval(this.onSecondElapsed.bind(this), 1000);
	}

	private onTimerElapsed() {
		this.removeInterval();

		// call user-provided handler
		this.onElapsedCb();
	}

	private onSecondElapsed() {
		this.leftSeconds--;
		if (this.leftSeconds < 1) { 
			this.onTimerElapsed();
			return;
		}
	}

	arm() {
		// kick off the timer
		this.leftSeconds = this.intervalSeconds;
		this.addInterval();
	}

	disarm() {
		this.removeInterval();
		this.leftSeconds = 0;
	}

	pause() {
		// remove interval, but don't reset the time left
		// effectively this pauses the timer.
		this.removeInterval();
	}

	wasArmed() {
		return this.leftSeconds !== 0;
	}

	unpause() {
		if(this.wasArmed())
			this.addInterval();
	}

	getRemaining() {
		//if(!this.wasArmed())
		// throw new Error('Only makes sense to call Timer#getRemaning() when timer is armed');
		return this.leftSeconds;
	}

	getInterval() {
		return this.intervalSeconds;
	}
}