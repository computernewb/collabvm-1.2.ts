import EventEmitter from 'node:events';
import { Size, Rect } from '../Utilities';

export interface VMDisplay extends EventEmitter {
	Connect(): void;
	Disconnect(): void;
	Connected(): boolean;
	Buffer(): Buffer;
	Size(): Size;
	MouseEvent(x: number, y: number, buttons: number): void;
	KeyboardEvent(keysym: number, pressed: boolean): void;
}
