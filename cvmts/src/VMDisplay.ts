import EventEmitter from 'node:events';

// not great but whatever
// nodejs-rfb COULD probably export them though.
export type Size = {
	width: number;
	height: number;
};

export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export interface VMDisplay extends EventEmitter {
	Connect(): void;
	Disconnect(): void;
	Connected(): boolean;
	Buffer(): Buffer;
	Size(): Size;
	MouseEvent(x: number, y: number, buttons: number): void;
	KeyboardEvent(keysym: number, pressed: boolean): void;
}
