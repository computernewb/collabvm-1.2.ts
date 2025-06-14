import { VMState } from '@wize-logic/superqemu';
import { VMDisplay } from '../display/interface.js';
import { EventEmitter } from 'node:events';

// Abstraction of VM interface
export default interface VM {
	// Starts the VM.
	Start(): Promise<void>;

	// Stops the VM.
	Stop(): Promise<void>;

	// Reboots the VM.
	Reboot(): Promise<void>;

	// Resets the VM.
	Reset(): Promise<void>;

	// Monitor command
	MonitorCommand(command: string): Promise<any>;

	// Start/connect the display
	StartDisplay(): void;

	// Gets the current active display
	// TODO: this could probaly be replaced with an event or something
	GetDisplay(): VMDisplay | null;

	GetState(): VMState;

	SnapshotsSupported(): boolean;

	Events(): EventEmitter;
}
