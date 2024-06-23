import { Format } from "./format";
import { StringLike } from "./StringLike";

export enum LogLevel {
	VERBOSE = 0,
	INFO,
	WARNING,
	ERROR
};


let gLogLevel = LogLevel.INFO;

export function SetLogLevel(level: LogLevel) {
	gLogLevel = level;
}

export class Logger {
	private _component: string;

	constructor(component: string) {
		this._component = component;
	}


	// TODO: use js argments stuff.

	Verbose(pattern: string, ...args: Array<StringLike>) {
		if(gLogLevel <= LogLevel.VERBOSE)
			console.log(`[${this._component}] [VERBOSE] ${Format(pattern, ...args)}`);
	}
	
	Info(pattern: string, ...args: Array<StringLike>) {
		if(gLogLevel <= LogLevel.INFO)
			console.log(`[${this._component}] [INFO] ${Format(pattern, ...args)}`);
	}

	Warning(pattern: string, ...args: Array<StringLike>) {			
		if(gLogLevel <= LogLevel.WARNING)
			console.warn(`[${this._component}] [WARNING] ${Format(pattern, ...args)}`);
	}

	Error(pattern: string, ...args: Array<StringLike>) {
		if(gLogLevel <= LogLevel.ERROR)
			console.error(`[${this._component}] [ERROR] ${Format(pattern, ...args)}`);
	}



}
