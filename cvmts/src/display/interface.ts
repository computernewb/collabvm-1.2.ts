import EventEmitter from 'node:events';
import { Size, Rect } from '../Utilities';


// events:
//
// 'connected' -> () -> on successful connection
// 'disconnect' -> () -> when disconnected 
// 'resize' -> (w, h) -> done when resize occurs
// 'rect' -> (x, y, Buffer) -> framebuffer rect (RGBA)
// 'frame' -> () -> done at end of frame
// 'fail' -> () -> failure to reconnect even when backing off.

export interface VMDisplay extends EventEmitter {
	Connect(): void;
	Disconnect(): void;
	Connected(): boolean;
	Buffer(): Buffer;
	Size(): Size;
	MouseEvent(x: number, y: number, buttons: number): void;
	KeyboardEvent(keysym: number, pressed: boolean): void;
}
