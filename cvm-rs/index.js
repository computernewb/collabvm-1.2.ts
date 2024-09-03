import { cvmrsRequire } from './require.js';

const { guacDecode, guacEncode } = cvmrsRequire('./index.node');

export { guacDecode, guacEncode };

export * from './vnc.js';
