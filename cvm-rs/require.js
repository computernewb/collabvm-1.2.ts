// Why Node.js Sucks, Reason #8712
import { createRequire } from 'node:module';

/// This is needed, because for some completely asanine
/// reason that isn't clear to me, ES import cannot be used
/// to load native modules. Why? Who knows. Who needs sanity
/// when you can just duct tape everything with hopes and dreams
/// and pray that it all works out in the end!
///
/// In short: Node.js sucks. And hacks like this
/// being a requirement for basic features to work
/// are why I will continue to hold this opinion.
/// (but I still use it, because it is unfortunately one of the most
/// Decent things I actually know for prototyping.)
export const cvmrsRequire = createRequire(import.meta.url);
