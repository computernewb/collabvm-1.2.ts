export class Stopwatch {
	private origin = 0;

	constructor() {
	}

	public reset() {
		this.origin = performance.now();
	}

	public get elapsedMillis() {
		return performance.now() - this.origin;
	}

	public get elapsedSeconds() {
		return this.elapsedMillis / 1000;
	}
};
