import { Size, Rect } from './Utilities';
import * as cvm from '@cvmts/cvm-rs';

const kThumbnailSize: Size = {
	width: 400,
	height: 300
};

export class JPEGEncoder {
	static async Encode(canvas: Buffer, displaySize: Size, rect: Rect, quality: number): Promise<Buffer> {
		let offset = (rect.y * displaySize.width + rect.x) * 4;
		return cvm.jpegEncode({
			width: rect.width,
			height: rect.height,
			stride: displaySize.width,
			buffer: canvas.subarray(offset),
			quality
		});
	}

	static async EncodeThumbnail(buffer: Buffer, size: Size, quality: number): Promise<Buffer> {
		return cvm.jpegResizeEncode({
			width: size.width,
			height: size.height,
			desiredWidth: kThumbnailSize.width,
			desiredHeight: kThumbnailSize.height,
			buffer: buffer,
			quality
		});
	}
}
