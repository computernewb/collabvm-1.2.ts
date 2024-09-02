import { cvmrsRequire } from './require.js';

const { guacDecode, guacEncodeImpl } = cvmrsRequire('./index.node');

export { guacDecode };

// shim for js->rust interop, because napi-rs kind of blows in this regard
export function guacEncode(...args) {
	return guacEncodeImpl(args);
}

export * from './vnc.js';
