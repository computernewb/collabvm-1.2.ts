import EventEmitter from 'node:events';
import { Size, Rect } from '../Utilities';


// events:
//
// 'connected' -> () -> on successful connection
// 'resize' -> (w, h) -> done when resize occurs
// 'rects' -> (rects: VMDisplayRect[]) -> framebuffer rects
// 'frame' -> () -> done at end of frame

export interface VMDisplayRect {
	rect: Rect,
	data: Buffer
}

export interface VMDisplay extends EventEmitter {
	Connect(): void;
	Disconnect(): void;
	Connected(): boolean;
	Size(): Size;

	/// Returns a promise that will resolve to a usable
	/// JPEG thumbnail.
	GetThumbnail(): Promise<Buffer>;

	/// Returns a promise that will resolve to the whole
	/// screen encoded as JPEG.
	GetFullScreen(): Promise<Buffer>;

	MouseEvent(x: number, y: number, buttons: number): void;
	KeyboardEvent(keysym: number, pressed: boolean): void;
}
