// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let {guacDecode, guacEncodeImpl, jpegEncode} = require('./index.node');

export { guacDecode, jpegEncode };

// shim for js->rust interop, because napi-rs kind of blows in this regard
export function guacEncode(...args) {
	return guacEncodeImpl(args);
}
