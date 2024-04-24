import jpegTurbo from '@computernewb/jpeg-turbo';
import Piscina from 'piscina';

export default async (opts: any) => {
	try {
		let res = await jpegTurbo.compress(opts.buffer, {
			format: jpegTurbo.FORMAT_RGBA,
			width: opts.width,
			height: opts.height,
			subsampling: jpegTurbo.SAMP_422,
			stride: opts.stride,
			quality: opts.quality || 75
		});

		return Piscina.move(res);
	} catch {
		return;
	}
};
