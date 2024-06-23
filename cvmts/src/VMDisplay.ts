import { Size } from '@cvmts/shared';
import EventEmitter from 'node:events';

export default interface VMDisplay extends EventEmitter {
	Connect(): void;
	Disconnect(): void;
	Connected(): boolean;
	Buffer(): Buffer;
	Size(): Size;
	MouseEvent(x: number, y: number, buttons: number): void;
	KeyboardEvent(keysym: number, pressed: boolean): void;
}
