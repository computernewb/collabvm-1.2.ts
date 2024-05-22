// This was originally based off the contents of the node-qemu-qmp package,
// but I've modified it possibly to the point where it could be treated as my own creation.

import split from 'split';

import { Socket } from 'net';

export type QmpCallback = (err: Error | null, res: any | null) => void;

type QmpCommandEntry = {
	callback: QmpCallback | null;
	id: number;
};

// TODO: Instead of the client "Is-A"ing a Socket, this should instead contain/store a Socket,
// (preferrably) passed by the user, to use for QMP communications.
// The client shouldn't have to know or care about the protocol, and it effectively hackily uses the fact
// Socket extends EventEmitter.

export default class QmpClient extends Socket {
	public qmpHandshakeData: any;
	private commandEntries: QmpCommandEntry[] = [];
	private lastID = 0;

	constructor() {
		super();

		this.assignHandlers();
	}

	private ExecuteSync(command: string, args: any | null, callback: QmpCallback | null) {
		let cmd: QmpCommandEntry = {
			callback: callback,
			id: ++this.lastID
		};

		let qmpOut: any = {
			execute: command,
			id: cmd.id
		};

		if (args) qmpOut['arguments'] = args;

		// Add stuff
		this.commandEntries.push(cmd);
		this.write(JSON.stringify(qmpOut));
	}

	// TODO: Make this function a bit more ergonomic?
	async Execute(command: string, args: any | null = null): Promise<any> {
		return new Promise((res, rej) => {
			this.ExecuteSync(command, args, (err, result) => {
				if (err) rej(err);
				res(result);
			});
		});
	}

	private Handshake(callback: () => void) {
		this.write(
			JSON.stringify({
				execute: 'qmp_capabilities'
			})
		);

		this.once('data', (data) => {
			// Once QEMU replies to us, the handshake is done.
			// We do not negotiate anything special.
			callback();
		});
	}

	// this can probably be made async
	private assignHandlers() {
		let self = this;

		this.on('connect', () => {
			// this should be more correct?
			this.once('data', (data) => {
				// Handshake QMP with the server.
				self.qmpHandshakeData = JSON.parse(data.toString('utf8')).QMP;
				self.Handshake(() => {
					// Now ready to parse QMP responses/events.
					self.pipe(split(JSON.parse))
						.on('data', (json: any) => {
							if (json == null) return self.end();

							if (json.return || json.error) {
								// Our handshake has a spurious return because we never assign it an ID,
								// and it is gathered by this pipe for some reason I'm not quite sure about.
								// So, just for safety's sake, don't process any return objects which don't have an ID attached to them.
								if (json.id == null) return;

								let callbackEntry = this.commandEntries.find((entry) => entry.id === json.id);
								let error: Error | null = json.error ? new Error(json.error.desc) : null;

								// we somehow didn't find a callback entry for this response.
								// I don't know how. Techinically not an error..., but I guess you're not getting a reponse to whatever causes this to happen
								if (callbackEntry == null) return;

								if (callbackEntry?.callback) callbackEntry.callback(error, json.return);

								// Remove the completed callback entry.
								this.commandEntries.slice(this.commandEntries.indexOf(callbackEntry));
							} else if (json.event) {
								this.emit('event', json);
							}
						})
						.on('error', () => {
							// Give up.
							return self.end();
						});
					this.emit('qmp-ready');
				});
			});
		});

		this.on('close', () => {
			this.end();
		});
	}

	Connect(host: string, port: number) {
		super.connect(port, host);
	}

	ConnectUNIX(path: string) {
		super.connect(path);
	}
}
