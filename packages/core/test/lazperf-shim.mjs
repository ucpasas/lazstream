// Stands in for the patched laz-perf-worker.js in node tests: the decode
// worker does `(await import(url)).default(opts)`. Decoding is identical to
// the patched browser build — the fork only patches the ESM loader.
//
// One shared instance: in tests the decode-worker module is a singleton
// re-initialised per engine, and its module-level compressedPtr must stay
// valid in the same heap. (Browsers give every Worker fresh module state.)
import { createLazPerf } from 'laz-perf'
let instance
export default () => (instance ??= createLazPerf())
