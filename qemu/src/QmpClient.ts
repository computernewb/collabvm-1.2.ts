import { EventEmitter } from 'node:events';

enum QmpClientState {
	Handshaking,
	Connected
}

function qmpStringify(obj: any) {
	return JSON.stringify(obj) + '\r\n';
}

// this writer interface is used to poll back to a higher level
// I/O layer that we want to write some data.
export interface IQmpClientWriter {
	writeSome(data: Buffer): void;
}

export type QmpClientCallback = (err: Error | null, res: any | null) => void;

type QmpClientCallbackEntry = {
	id: number;
	callback: QmpClientCallback | null;
};

export enum QmpEvent {
	BlockIOError = 'BLOCK_IO_ERROR',
	Reset = 'RESET',
	Resume = 'RESUME',
	RtcChange = 'RTC_CHANGE',
	Shutdown = 'SHUTDOWN',
	Stop = 'STOP',
	VncConnected = 'VNC_CONNECTED',
	VncDisconnected = 'VNC_DISCONNECTED',
	VncInitialized = 'VNC_INITIALIZED',
	Watchdog = 'WATCHDOG'
}

class LineStream extends EventEmitter {
	// The given line seperator for the stream
	lineSeperator = '\r\n';
	buffer = '';

	constructor() {
		super();
	}

	push(data: Buffer) {
		this.buffer += data.toString('utf-8');

		let lines = this.buffer.split(this.lineSeperator);
		if (lines.length > 1) {
			this.buffer = lines.pop()!;
			lines = lines.filter((l) => !!l);
			lines.forEach(l => this.emit('line', l));
		}
	}

	reset() {
		this.buffer = '';
	}
}

// A QMP client
export class QmpClient extends EventEmitter {
	private state = QmpClientState.Handshaking;
	private writer: IQmpClientWriter | null = null;

	private lastID = 0;
	private callbacks = new Array<QmpClientCallbackEntry>();

	private lineStream = new LineStream();

	constructor() {
		super();

		let self = this;
		this.lineStream.on('line', (line: string) => {
			self.handleQmpLine(line);
		});
	}

	setWriter(writer: IQmpClientWriter|null) {
		this.writer = writer;
	}

	feed(data: Buffer): void {
		// Forward to the line stream. It will generate 'line' events
		// as it is able to split out lines automatically.
		this.lineStream.push(data);
	}

	private handleQmpLine(line: string) {
		let obj = JSON.parse(line);

		switch (this.state) {
			case QmpClientState.Handshaking:
				if (obj['return'] != undefined) {
					// Once we get a return from our handshake execution,
					// we have exited handshake state.
					this.state = QmpClientState.Connected;
					this.emit('connected');
					return;
				} else if(obj['QMP'] != undefined) {
					// Send a `qmp_capabilities` command, to exit handshake state.
					// We do not support any of the supported extended QMP capabilities currently,
					// and probably never will (due to their relative uselessness.)
					let capabilities = qmpStringify({
						execute: 'qmp_capabilities'
					});

					this.writer?.writeSome(Buffer.from(capabilities, 'utf8'));
				}
				break;

			case QmpClientState.Connected:
				if (obj['return'] != undefined || obj['error'] != undefined) {
					if (obj['id'] == null) return;

					let cb = this.callbacks.find((v) => v.id == obj['id']);
					if (cb == undefined) return;

					let error: Error | null = obj.error ? new Error(obj.error.desc) : null;

					if (cb.callback) cb.callback(error, obj.return || null);

					this.callbacks.slice(this.callbacks.indexOf(cb));
				} else if (obj['event']) {
					this.emit(obj.event, {
						timestamp: obj.timestamp,
						data: obj.data
					});
				}
				break;
		}
	}

	// Executes a QMP command, using a user-provided callback for completion notification
	executeCallback(command: string, args: any | undefined, callback: QmpClientCallback | null) {
		let entry = {
			callback: callback,
			id: ++this.lastID
		};

		let qmpOut: any = {
			execute: command,
			id: entry.id
		};

		if (args !== undefined) qmpOut['arguments'] = args;

		this.callbacks.push(entry);
		this.writer?.writeSome(Buffer.from(qmpStringify(qmpOut), 'utf8'));
	}

	// Executes a QMP command asynchronously.
	async execute(command: string, args: any | undefined = undefined): Promise<any> {
		return new Promise((res, rej) => {
			this.executeCallback(command, args, (err, result) => {
				if (err) rej(err);
				res(result);
			});
		});
	}

	reset() {
		// Reset the line stream so it doesn't go awry
		this.lineStream.reset();
		this.state = QmpClientState.Handshaking;
	}
}
