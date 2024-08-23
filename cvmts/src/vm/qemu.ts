import EventEmitter from 'events';
import VM from './interface.js';
import { QemuVM, QemuVmDefinition, VMState } from '@computernewb/superqemu';
import { VMDisplay } from '../display/interface.js';
import { VncDisplay } from '../display/vnc.js';
import pino from 'pino';

// shim over superqemu because it diverges from the VM interface
export class QemuVMShim implements VM {
	private vm;
	private display: VncDisplay | null = null;
	private logger;

	constructor(def: QemuVmDefinition) {
		this.vm = new QemuVM(def);
		this.logger = pino({ name: `CVMTS.QemuVMShim/${def.id}` });
	}

	Start(): Promise<void> {
		return this.vm.Start();
	}

	async Stop(): Promise<void> {
		await this.vm.Stop();

		this.display?.Disconnect();
		this.display = null;
	}

	Reboot(): Promise<void> {
		return this.vm.Reboot();
	}

	Reset(): Promise<void> {
		return this.vm.Reset();
	}

	MonitorCommand(command: string): Promise<any> {
		return this.vm.MonitorCommand(command);
	}

	StartDisplay(): void {
		// boot it up
		let info = this.vm.GetDisplayInfo();

		if (info == null) throw new Error('its dead jim');

		switch (info.type) {
			case 'vnc-tcp':
				this.display = new VncDisplay({
					host: info.host || '127.0.0.1',
					port: info.port || 5900,
					path: null
				});
				break;
			case 'vnc-uds':
				this.display = new VncDisplay({
					path: info.path
				});
				break;
		}

		let self = this;

		this.display?.on('connected', () => {
			// The VM can now be considered started
			self.logger.info('Display connected');
		});

		// now that QMP has connected, connect to the display
		self.display?.Connect();
	}

	GetDisplay(): VMDisplay | null {
		return this.display;
	}

	GetState(): VMState {
		return this.vm.GetState();
	}

	SnapshotsSupported(): boolean {
		return this.vm.SnapshotsSupported();
	}

	Events(): EventEmitter {
		return this.vm;
	}
}
