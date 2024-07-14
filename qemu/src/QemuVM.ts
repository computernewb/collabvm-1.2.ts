import { execa, execaCommand, ExecaChildProcess } from 'execa';
import { EventEmitter } from 'events';
import { QmpClient, IQmpClientWriter, QmpEvent } from './QmpClient.js';
import { QemuDisplay } from './QemuDisplay.js';
import { unlink } from 'node:fs/promises';

import * as Shared from '@cvmts/shared';
import { Socket, connect } from 'net';
import { Readable, Stream, Writable } from 'stream';

export enum VMState {
	Stopped,
	Starting,
	Started,
	Stopping
}

export type QemuVmDefinition = {
	id: string;
	command: string;
	snapshot: boolean;
};

/// Temporary path base (for UNIX sockets/etc.)
const kVmTmpPathBase = `/tmp`;

// writer implementation for process standard I/O
class StdioWriter implements IQmpClientWriter {
	stdout;
	stdin;
	client;

	constructor(stdout: Readable, stdin: Writable, client: QmpClient) {
		this.stdout = stdout;
		this.stdin = stdin;
		this.client = client;

		this.stdout.on('data', (data) => {
			this.client.feed(data);
		});
	}

	writeSome(buffer: Buffer) {
		this.stdin.write(buffer);
	}
}

export class QemuVM extends EventEmitter {
	private state = VMState.Stopped;

	// QMP stuff.
	private qmpInstance: QmpClient = new QmpClient();

	private qemuProcess: ExecaChildProcess | null = null;

	private display: QemuDisplay | null = null;
	private definition: QemuVmDefinition;
	private addedAdditionalArguments = false;

	private logger: Shared.Logger;

	constructor(def: QemuVmDefinition) {
		super();
		this.definition = def;
		this.logger = new Shared.Logger(`CVMTS.QEMU.QemuVM/${this.definition.id}`);

		let self = this;

		// Handle the STOP event sent when using -no-shutdown
		this.qmpInstance.on(QmpEvent.Stop, async () => {
			await self.qmpInstance.execute('system_reset');
		});

		this.qmpInstance.on(QmpEvent.Reset, async () => {
			await self.qmpInstance.execute('cont');
		});

		this.qmpInstance.on('connected', async () => {
			self.VMLog().Info('QMP ready');

			this.display = new QemuDisplay(this.GetVncPath());

			self.display?.on('connected', () => {
				// The VM can now be considered started
				self.VMLog().Info("Display connected");
				self.SetState(VMState.Started);
			})

			// now that QMP has connected, connect to the display
			self.display?.Connect();
		});
	}

	async Start() {
		// Don't start while either trying to start or starting.
		//if (this.state == VMState.Started || this.state == VMState.Starting) return;
		if (this.qemuProcess) return;

		let cmd = this.definition.command;

		// Build additional command line statements to enable qmp/vnc over unix sockets
		if (!this.addedAdditionalArguments) {
			cmd += ' -no-shutdown';
			if (this.definition.snapshot) cmd += ' -snapshot';
			cmd += ` -qmp stdio -vnc unix:${this.GetVncPath()}`;
			this.definition.command = cmd;
			this.addedAdditionalArguments = true;
		}

		await this.StartQemu(cmd);
	}

	SnapshotsSupported(): boolean {
		return this.definition.snapshot;
	}

	async Reboot(): Promise<void> {
		await this.MonitorCommand('system_reset');
	}

	async Stop() {
		this.AssertState(VMState.Started, 'cannot use QemuVM#Stop on a non-started VM');

		// Indicate we're stopping, so we don't erroneously start trying to restart everything we're going to tear down.
		this.SetState(VMState.Stopping);

		// Stop the QEMU process, which will bring down everything else.
		await this.StopQemu();
	}

	async Reset() {
		this.AssertState(VMState.Started, 'cannot use QemuVM#Reset on a non-started VM');
		await this.StopQemu();
	}

	async QmpCommand(command: string, args: any | null): Promise<any> {
		return await this.qmpInstance?.execute(command, args);
	}

	async MonitorCommand(command: string) {
		this.AssertState(VMState.Started, 'cannot use QemuVM#MonitorCommand on a non-started VM');
		let result = await this.QmpCommand('human-monitor-command', {
			'command-line': command
		});
		if (result == null) result = '';
		return result;
	}

	async ChangeRemovableMedia(deviceName: string, imagePath: string): Promise<void> {
		this.AssertState(VMState.Started, 'cannot use QemuVM#ChangeRemovableMedia on a non-started VM');
		// N.B: if this throws, the code which called this should handle the error accordingly
		await this.QmpCommand('blockdev-change-medium', {
			device: deviceName, // techinically deprecated, but I don't feel like figuring out QOM path just for a simple function
			filename: imagePath
		});
	}

	async EjectRemovableMedia(deviceName: string) {
		this.AssertState(VMState.Started, 'cannot use QemuVM#EjectRemovableMedia on a non-started VM');
		await this.QmpCommand('eject', {
			device: deviceName
		});
	}

	GetDisplay() {
		return this.display!;
	}

	GetState() {
		return this.state;
	}

	/// Private fun bits :)

	private VMLog() {
		return this.logger;
	}

	private AssertState(stateShouldBe: VMState, message: string) {
		if (this.state !== stateShouldBe) throw new Error(message);
	}

	private SetState(state: VMState) {
		this.state = state;
		this.emit('statechange', this.state);
	}

	private GetQmpPath() {
		return `${kVmTmpPathBase}/cvmts-${this.definition.id}-mon`;
	}

	private GetVncPath() {
		return `${kVmTmpPathBase}/cvmts-${this.definition.id}-vnc`;
	}

	private async StartQemu(split: string) {
		let self = this;

		this.SetState(VMState.Starting);

		this.VMLog().Info(`Starting QEMU with command \"${split}\"`);

		// Start QEMU
		this.qemuProcess = execaCommand(split, {
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe'
		});

		this.qemuProcess.stderr?.on('data', (data) => {
			self.VMLog().Error('QEMU stderr: {0}', data.toString('utf8'));
		});

		this.qemuProcess.on('spawn', async () => {
			self.VMLog().Info('QEMU started');
			await self.QmpStdioInit();
		});

		this.qemuProcess.on('exit', async (code) => {
			self.VMLog().Info('QEMU process exited');

			// Disconnect from the display and QMP connections.
			await self.DisconnectDisplay();

			self.qmpInstance.reset();
			self.qmpInstance.setWriter(null);

			// Remove the VNC UDS socket.
			try {
				await unlink(this.GetVncPath());
			} catch (_) {}

			if (self.state != VMState.Stopping) {
				if (code == 0) {
					// Wait a bit and restart QEMU.
					await Shared.Sleep(500);
					await self.StartQemu(split);
				} else {
					self.VMLog().Error('QEMU exited with a non-zero exit code. This usually means an error in the command line. Stopping VM.');
					// Note that we've already tore down everything upon entry to this event handler; therefore
					// we can simply set the state and move on.
					this.SetState(VMState.Stopped);
				}
			} else {
				// Indicate we have stopped.
				this.SetState(VMState.Stopped);
			}
		});
	}

	private async StopQemu() {
		if (this.qemuProcess) {
			this.qemuProcess?.kill('SIGTERM');
			this.qemuProcess = null;
		}
	}

	private async QmpStdioInit() {
		let self = this;

		self.VMLog().Info("Initializing QMP over stdio");

		// Setup the QMP client.
		let writer = new StdioWriter(this.qemuProcess?.stdout!, this.qemuProcess?.stdin!, self.qmpInstance);
		self.qmpInstance.reset();
		self.qmpInstance.setWriter(writer);
	}

	private async DisconnectDisplay() {
		try {
			this.display?.Disconnect();
			this.display = null;
		} catch (err) {
			// oh well lol
		}
	}
}
