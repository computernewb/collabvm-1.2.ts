import path from 'node:path';
import Piscina from 'piscina';

import { Size, Rect } from '@cvmts/shared';

const kMaxJpegThreads = 4;
const kIdleTimeout = 25000;

// Thread pool for doing JPEG encoding for rects.
const TheJpegEncoderPool = new Piscina({
	filename: path.join(import.meta.dirname + '/JPEGEncoderWorker.js'),
	idleTimeout: kIdleTimeout,
	maxThreads: kMaxJpegThreads
});

const TheThumbnailEncoderPool = new Piscina({
	filename: path.join(import.meta.dirname + '/ThumbnailJPEGEncoderWorker.js'),
	idleTimeout: kIdleTimeout,
	maxThreads: kMaxJpegThreads
});

// A good balance. TODO: Configurable?
let gJpegQuality = 35;

export class JPEGEncoder {

	static SetQuality(quality: number) {
		gJpegQuality = quality;
	}

	static async EncodeJpeg(canvas: Buffer, displaySize: Size, rect: Rect): Promise<Buffer> {
		let offset = (rect.y * displaySize.width + rect.x) * 4;

		let res = await TheJpegEncoderPool.run({
			buffer: canvas.subarray(offset),
			width: rect.width,
			height: rect.height,
			stride: displaySize.width,
			quality: gJpegQuality
		});

		// TODO: There's probably (definitely) a better way to fix this
		if (res == undefined) return Buffer.from([]);

		// have to manually turn it back into a buffer because
		// Piscina for some reason turns it into a Uint8Array
		return Buffer.from(res);
	}

	static async EncodeThumbnail(buffer: Buffer, size: Size) : Promise<Buffer>  {
		let res = await TheThumbnailEncoderPool.run({
			buffer: buffer,
			size: size,
			quality: gJpegQuality
		});

		return Buffer.from(res)
	}
}
