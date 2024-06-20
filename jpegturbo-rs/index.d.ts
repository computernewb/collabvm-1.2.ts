
interface JpegInputArgs {
	width: number,
	height: number,
	stride: number, // The width of your input framebuffer OR your image width (if encoding a full image)
	buffer: Buffer

	// TODO: Allow different formats, or export a boxed ffi object which can store a format
	// (i.e: new JpegEncoder(FORMAT_xxx)).
}

/// Performs JPEG encoding.
export function jpegEncode(input: JpegInputArgs) : Promise<Buffer>;

// TODO: Version that can downscale?
