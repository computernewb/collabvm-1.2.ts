// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let {guacDecode, guacEncodeImpl, jpegEncode, jpegResizeEncode} = require('./index.node');

export { guacDecode, jpegEncode, jpegResizeEncode };

// shim for js->rust interop, because napi-rs kind of blows in this regard
export function guacEncode(...args) {
	return guacEncodeImpl(args);
}
