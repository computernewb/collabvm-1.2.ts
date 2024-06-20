import { execa, execaCommand, ExecaChildProcess } from 'execa';
import { EventEmitter } from 'events';
import QmpClient from './QmpClient.js';
import { QemuDisplay } from './QemuDisplay.js';
import { unlink } from 'node:fs/promises';

import * as Shared from '@cvmts/shared';

export enum VMState {
	Stopped,
	Starting,
	Started,
	Stopping
}

// TODO: Add bits to this to allow usage (optionally)
// of VNC/QMP port. This will be needed to fix up Windows support.
export type QemuVmDefinition = {
	id: string,
	command: string,
	snapshot: boolean
};

/// Temporary path base (for UNIX sockets/etc.)
const kVmTmpPathBase = `/tmp`;

/// The max amount of times QMP connection is allowed to fail before
/// the VM is forcefully stopped.
const kMaxFailCount = 5;

export class QemuVM extends EventEmitter {
	private state = VMState.Stopped;

	private qmpInstance: QmpClient | null = null;
	private qmpConnected = false;
	private qmpFailCount = 0;

	private qemuProcess: ExecaChildProcess | null = null;
	private qemuRunning = false;

	private display: QemuDisplay;
	private definition: QemuVmDefinition;
	private addedAdditionalArguments = false;

	private logger: Shared.Logger;

	constructor(def: QemuVmDefinition) {
		super();
		this.definition = def;
		this.logger = new Shared.Logger(`CVMTS.QEMU.QemuVM/${this.definition.id}`);

		this.display = new QemuDisplay(this.GetVncPath());
	}

	async Start() {
		// Don't start while either trying to start or starting.
		if (this.state == VMState.Started || this.state == VMState.Starting) return;

		let cmd = this.definition.command;

		// build additional command line statements to enable qmp/vnc over unix sockets
		// FIXME: Still use TCP if on Windows.
		if (!this.addedAdditionalArguments) {
			cmd += ' -no-shutdown';
			if (this.definition.snapshot) cmd += ' -snapshot';
			cmd += ` -qmp unix:${this.GetQmpPath()},server,wait -vnc unix:${this.GetVncPath()}`;
			this.definition.command = cmd;
			this.addedAdditionalArguments = true;
		}

		await this.StartQemu(cmd);
	}

	SnapshotsSupported() : boolean {
		return this.definition.snapshot;
	}

	async Reboot() : Promise<void> {
		await this.MonitorCommand('system_reset');
	}

	async Stop() {
		// This is called in certain lifecycle places where we can't safely assert state yet
		//this.AssertState(VMState.Started, 'cannot use QemuVM#Stop on a non-started VM');
		
		// Indicate we're stopping, so we don't
		// erroneously start trying to restart everything
		// we're going to tear down.
		this.SetState(VMState.Stopping);

		// Kill the QEMU process and QMP/display connections if they are running.
		await this.DisconnectQmp();
		await this.DisconnectDisplay();
		await this.StopQemu();

	}

	async Reset() {
		//this.AssertState(VMState.Started, 'cannot use QemuVM#Reset on a non-started VM');

		// let code know the VM is going to reset
		this.emit('reset');

		// Do magic.
		await this.StopQemu();
	}

	async QmpCommand(command: string, args: any | null): Promise<any> {
		return await this.qmpInstance?.Execute(command, args);
	}

	async MonitorCommand(command: string) {
		this.AssertState(VMState.Started, 'cannot use QemuVM#MonitorCommand on a non-started VM');
		return await this.QmpCommand('human-monitor-command', {
			'command-line': command
		});
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
		return this.display;
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

		// reset some state when starting the vm back up
		// to avoid potentional issues.
		if(this.state == VMState.Starting) {
			this.qmpFailCount = 0;
		}
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
		this.qemuProcess = execaCommand(split);

		this.qemuProcess.on('spawn', async () => {
			self.VMLog().Info("QEMU started");
			self.qemuRunning = true;
			await Shared.Sleep(500);
			await self.ConnectQmp();
		});

		this.qemuProcess.on('exit', async (code) => {
			self.VMLog().Info("QEMU process exited");
			self.qemuRunning = false;


			// this should be being done anways but it's very clearly not sometimes so
			// fuck it, let's just force it here
			try {
				await unlink(this.GetVncPath());
			} catch(_) {}

			try {
				await unlink(this.GetQmpPath());
			} catch(_) {}

			// ?
			if (self.qmpConnected) {
				await self.DisconnectQmp();
			}

			await self.DisconnectDisplay();


			if (self.state != VMState.Stopping) {
				if (code == 0) {
					// Wait a bit and restart QEMU.
					await Shared.Sleep(500);
					await self.StartQemu(split);
				} else {
					self.VMLog().Error('QEMU exited with a non-zero exit code. This usually means an error in the command line. Stopping VM.');
					await self.Stop();
				}
			} else {
				// Indicate we have stopped.
				this.SetState(VMState.Stopped);
			}
		});
	}

	private async StopQemu() {
		if (this.qemuRunning == true) this.qemuProcess?.kill('SIGTERM');
	}

	private async ConnectQmp() {
		let self = this;

		if (!this.qmpConnected) {
			self.qmpInstance = new QmpClient();

			let onQmpError = async () => {
				if(self.qmpConnected) {
					self.qmpConnected = false;

					// If we aren't stopping, then we should care QMP disconnected
					if (self.state != VMState.Stopping) {
						if (self.qmpFailCount++ < kMaxFailCount) {
							self.VMLog().Error(`Failed to connect to QMP ${self.qmpFailCount} times.`);
							await Shared.Sleep(500);
							await self.ConnectQmp();
						} else {
							self.VMLog().Error(`Reached max retries, giving up.`);
							await self.Stop();
						}
					}
				}
			};

			self.qmpInstance.on('close', onQmpError);
			self.qmpInstance.on('error', (e: Error) => {
				self.VMLog().Error("QMP Error: {0}", e.message);
			});

			self.qmpInstance.on('event', async (ev) => {
				switch (ev.event) {
					// Handle the STOP event sent when using -no-shutdown
					case 'STOP':
						await self.qmpInstance?.Execute('system_reset');
						break;
					case 'RESET':
						await self.qmpInstance?.Execute('cont');
						break;
				}
			});

			self.qmpInstance.on('qmp-ready', async (hadError) => {
				self.VMLog().Info('QMP ready');

				self.display.Connect();

				// QMP has been connected so the VM is ready to be considered started
				self.qmpFailCount = 0;
				self.qmpConnected = true;
				self.SetState(VMState.Started);
			});

			try {
				await Shared.Sleep(500);
				this.qmpInstance?.ConnectUNIX(this.GetQmpPath());
			} catch (err) {
				// just try again
				await Shared.Sleep(500);
				await this.ConnectQmp();
			}
		}
	}

	private async DisconnectDisplay() {
		try {
			this.display?.Disconnect();
			//this.display = null; // disassociate with that display object.
		} catch (err) {
			// oh well lol
		}
	}

	private async DisconnectQmp() {
		if (this.qmpConnected) return;
		if (this.qmpInstance == null) return;

		this.qmpConnected = false;
		this.qmpInstance.end();
		this.qmpInstance = null;
		try {
			await unlink(this.GetQmpPath());
		} catch (err) {}
	}
}
