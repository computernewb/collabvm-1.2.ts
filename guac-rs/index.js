// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export let {guacDecode, guacEncode} = require('./index.node');

