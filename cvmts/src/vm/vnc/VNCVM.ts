import EventEmitter from 'events';
import VNCVMDef from './VNCVMDef';
import VM from '../interface.js';
import { VMDisplay } from '../../display/interface.js';
import { VMState } from '@computernewb/superqemu';
import { execaCommand } from 'execa';
import pino from 'pino';
import { VncDisplay } from '../../display/vnc.js';

function Clamp(input: number, min: number, max: number) {
	return Math.min(Math.max(input, min), max);
}

async function Sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class VNCVM extends EventEmitter implements VM {
	def: VNCVMDef;
	logger;
	private vnc: VncDisplay | null = null;
	private state = VMState.Stopped;

	constructor(def: VNCVMDef) {
		super();
		this.def = def;
		// TODO: Now that we're using an actual structured logger can we please
		this.logger = pino({ name: `CVMTS.VNCVM/${this.def.vncHost}:${this.def.vncPort}` });
	}

	async Reset(): Promise<void> {
		if (this.def.restoreCmd) await execaCommand(this.def.restoreCmd, { shell: true });
		else {
			await this.Stop();
			await Sleep(1000);
			await this.Start();
		}
	}
	private Disconnect() {
		if (this.vnc) {
			this.vnc.Disconnect();
		}
	}

	private SetState(newState: VMState) {
		this.state = newState;
		this.emit('statechange', newState);
	}

	StartDisplay(): void {
		this.logger.info('Connecting to VNC server');
		let self = this;

		if (this.vnc == null) {
			this.vnc = new VncDisplay({
				host: this.def.vncHost,
				port: this.def.vncPort,
				path: null
			});

			this.vnc.on('connected', () => {
				self.logger.info('Connected to VNC server');
			});

			this.vnc.on('finalDisconnect', () => {
				self.SetState(VMState.Stopped);
			});

			this.vnc!.on('fail', async () => {
				self.logger.info('Failed to connect to VNC server');
				await self.Stop();
			});
		}

		this.vnc.Connect();
	}

	async Start(): Promise<void> {
		if (this.def.startCmd) await execaCommand(this.def.startCmd, { shell: true });
		this.SetState(VMState.Started);
	}

	async Stop(): Promise<void> {
		if (this.def.stopCmd) await execaCommand(this.def.stopCmd, { shell: true });
		this.SetState(VMState.Stopping);
	}

	async Reboot(): Promise<void> {
		if (this.def.rebootCmd) await execaCommand(this.def.rebootCmd, { shell: true });
	}

	async MonitorCommand(command: string): Promise<any> {
		// TODO: This can maybe run a specified command?
		return 'This VM does not support monitor commands.';
	}

	GetDisplay(): VMDisplay | null {
		return this.vnc;
	}

	GetState(): VMState {
		return this.state;
	}

	SnapshotsSupported(): boolean {
		return true;
	}

	Events(): EventEmitter {
		return this;
	}
}
