//

import EventEmitter from 'events';

// Guacamole Codec
export function guacDecode(input: string): string[];
export function guacEncode(...items: string[]): string;

/// VNC client. Implemented in Rust, however some binding is done in JS
/// to clean the API up.
export class VncClient extends EventEmitter {
	Connect(addr: string): void;

	SendMouse(x: number, y: number, buttons: number): Promise<void>;

	SendKey(keysym: number, pressed: boolean): Promise<void>;

	Size(): any;

	FullScreen(): Promise<Buffer>;

	SetJpegQuality(quality: number): void;

	Thumbnail(): Promise<Buffer>;

	Disconnect(): void;
}
