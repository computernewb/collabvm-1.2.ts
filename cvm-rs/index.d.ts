//

import EventEmitter from 'events';

// Guacamole Codec
export function guacDecode(input: string): string[];
export function guacEncode(...items: string[]): string;

// JPEG Encoding (deprecated)
/** @deprecated This API is no longer supported. Do not use it */
interface JpegInputArgs {
	width: number;
	height: number;
	stride: number; // The width of your input framebuffer OR your image width (if encoding a full image)
	buffer: Buffer;

	// TODO: Allow different formats, or export a boxed ffi object which can store a format
	// (i.e: new JpegEncoder(FORMAT_xxx)).
}

/// Performs JPEG encoding.
/** @deprecated This API is no longer supported. Do not use it */
export function jpegEncode(input: JpegInputArgs): Promise<Buffer>;

// TODO: Version that can downscale?

/// VNC client. Implemented in Rust, however some binding is done in JS
/// to clean the API up.
export class VncClient extends EventEmitter {
	Connect(addr: string): void;

	SendMouse(x: number, y: number, buttons: number): Promise<void>;

	SendKey(keysym: number, pressed: boolean): Promise<void>;

	Size(): any;

	FullScreen(): Promise<Buffer>;

	Thumbnail(): Promise<Buffer>;

	Disconnect(): void;
}
