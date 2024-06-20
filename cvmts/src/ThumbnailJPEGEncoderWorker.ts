import { Size } from '@cvmts/shared';
import Piscina from 'piscina';
import sharp from 'sharp';

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

export default async (opts: any) => {
	try {
		let out = await sharp(opts.buffer, { raw: GetRawSharpOptions(opts.size) })
			.resize(kThumbnailSize.width, kThumbnailSize.height, { fit: 'fill' })
			.jpeg({
				quality: opts.quality || 75
			})
			.toFormat('jpeg')
			.toBuffer();

		return out;
	} catch {
		return;
	}

};
