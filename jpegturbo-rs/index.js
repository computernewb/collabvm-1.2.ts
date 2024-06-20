// *sigh*
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export let {jpegEncode} = require('./index.node');

