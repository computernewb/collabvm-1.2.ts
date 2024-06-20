import { Size, Rect } from '@cvmts/shared';
import sharp from 'sharp';
import * as jpeg from '@cvmts/jpegturbo-rs';

// A good balance. TODO: Configurable?
let gJpegQuality = 35;

const kThumbnailSize: Size = {
	width: 400,
	height: 300
};

// this returns appropiate Sharp options to deal with CVMTS raw framebuffers
// (which are RGBA bitmaps, essentially. We probably should abstract that out but
// that'd mean having to introduce that to rfb and oihwekjtgferklds;./tghnredsltg;erhds)
function GetRawSharpOptions(size: Size): sharp.CreateRaw {
	return {
		width: size.width,
		height: size.height,
		channels: 4
	};
}

export class JPEGEncoder {
	static SetQuality(quality: number) {
		gJpegQuality = quality;
	}

	static async Encode(canvas: Buffer, displaySize: Size, rect: Rect): Promise<Buffer> {
		let offset = (rect.y * displaySize.width + rect.x) * 4;
		return jpeg.jpegEncode({
			width: rect.width,
			height: rect.height,
			stride: displaySize.width,
			buffer: canvas.subarray(offset)
		});
	}

	static async EncodeThumbnail(buffer: Buffer, size: Size): Promise<Buffer> {
		let { data, info } = await sharp(buffer, { raw: GetRawSharpOptions(size) })
			.resize(kThumbnailSize.width, kThumbnailSize.height, { fit: 'fill' })
			.raw()
			.toBuffer({ resolveWithObject: true });

		return jpeg.jpegEncode({
			width: kThumbnailSize.width,
			height: kThumbnailSize.height,
			stride: kThumbnailSize.width,
			buffer: data
		});
	}
}
