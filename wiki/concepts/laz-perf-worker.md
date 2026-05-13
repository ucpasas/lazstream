---
title: laz-perf Worker Porting
type: concept
status: active
updated: 2026-05-12
tags: [laz-perf, wasm, workers, vite, emscripten, esm, patch]
---

# laz-perf Worker Porting

Complete record of porting `laz-perf 0.0.7` to run inside Vite module workers. This took the majority of Phase 2 Track A session time. The knowledge here is non-obvious and will not be re-derivable from the code.

---

## Root problem

The npm package `laz-perf@0.0.7` (`hobuinc/laz-perf`) is compiled with Emscripten flag `-sENVIRONMENT=web`. This hardcodes `ENVIRONMENT_IS_WORKER=false` and adds:

```javascript
assert(!ENVIRONMENT_IS_WORKER, "worker environment detected but not enabled at build time.")
```

This assertion fires in any worker context. **The npm package cannot be used in a Web Worker without a custom build from source.**

---

## Vite dev mode always produces module workers

`worker.format: 'iife'` in `vite.config.ts` only affects `vite build` (production). In dev mode, Vite's dev server **always** serves workers as ES module workers regardless of this setting.

**Consequence:** `importScripts()` is permanently unavailable in Vite dev workers. Any approach that relies on `importScripts()` will never work in dev.

---

## Attempt log

### Attempt 1 — Vite worker format switching

Tried switching `worker.format` between `'es'` and `'iife'`. **Result:** no effect in dev. The `Cannot use import statement outside a module` error confirmed workers remain ESM in dev.

### Attempt 2 — `@rollup/plugin-commonjs` in worker config

Added `commonjs()` to `worker.plugins`. **Result:** `exports is not defined` is not a CJS/ESM problem — it's the Emscripten UMD fallback executing without a matching branch. The real blocker is the `ENVIRONMENT_IS_WORKER=false` assertion.

### Attempt 3 — `laz-rs-wasm` (Rust alternative)

`laz-rs-wasm` is not published on npm. The Rust crate exists but building from source requires Rust + wasm-pack with an undocumented API. **Ruled out.**

### Attempt 4 — Rebuild laz-perf with worker target

The laz-perf source `js/wasm.sh` includes a `build worker` step producing `js/lib/worker/laz-perf.js` + `.wasm` with `ENVIRONMENT_IS_WORKER=true`. Built with Docker:

```bash
docker run --rm -v $(pwd):/src emscripten/emsdk:3.1.20 bash -c "..."
```

**Result:** assertion failure resolved, but still failed in Vite module workers because:
1. Environment check requires `typeof importScripts === "function"` — not present in module workers
2. UMD export tail uses `exports`/`module.exports` — not present in ESM, making `createLazPerf` unreachable

### Attempt 5 — Classic worker IIFE bundle with `importScripts()`

Tried spawning classic workers (`no { type: 'module' }`) with `format: 'iife'` and loading laz-perf via `importScripts(url)`. **Result:** Vite dev ignores `worker.format` — workers are still served as ESM modules. `importScripts()` fails.

---

## Resolution: two surgical patches to the vendored worker build

Since Vite dev always produces module workers, laz-perf must be loadable via `dynamic import()` as a valid ES module.

### Patch 1 — Environment check

```javascript
// Before:
if(!(typeof window=="object"||typeof importScripts=="function"))
  throw new Error("not compiled for this environment")

// After — add WorkerGlobalScope (defined in both classic and module workers):
if(!(typeof window=="object"||typeof importScripts=="function"
  ||typeof WorkerGlobalScope!="undefined"))
  throw new Error("not compiled for this environment")
```

### Patch 2 — UMD tail → ESM named re-export

```javascript
// Before (UMD — none of these branches match in ESM context):
if (typeof exports === 'object' && typeof module === 'object')
  module.exports = createLazPerf;
else if (typeof define === 'function' && define['amd'])
  define([], function() { return createLazPerf; });
else if (typeof exports === 'object')
  exports["createLazPerf"] = createLazPerf;

// After — named re-export exports the live binding:
export { createLazPerf as default };
```

**Critical:** `export default createLazPerf` (value export) was tried first and failed — `mod.default` returned `undefined` with `keys: Array(0)`. The named re-export form `export { createLazPerf as default }` exports the live binding and works correctly.

The patch is applied by `js/patch-lazperf.sh` (or `js/patch-worker-esm.py`) after the worker build step.

---

## Vite `?url` import is broken inside workers

`?url` imports resolve correctly on the main thread. The same URL passed to a worker and used in `dynamic import()` is intercepted by Vite, which returns a transformed module with all exports stripped.

**Fix:** Derive URLs from `window.location.origin` on the main thread; pass them to workers via the `init` message:

```typescript
// worker-pool.ts
const lazPerfWorkerUrl = `${window.location.origin}/lib/laz-perf-worker.js`
const lazPerfWasmUrl   = `${window.location.origin}/lib/laz-perf-worker.wasm`
```

Files in `public/lib/` are served at their literal paths without Vite transformation.

---

## WASM location override

laz-perf resolves `.wasm` relative to `self.location.href` (the worker bundle URL) by default. Without a `locateFile` override, it fetches from the wrong path.

**Fix:** pass `locateFile` to the factory function:

```typescript
Module = await createLazPerf({
  locateFile: (path: string) => {
    if (path.endsWith('.wasm')) return lazPerfWasmUrl
    return path
  }
})
```

---

## Dynamic import inside worker

```typescript
// decode-worker.ts
const mod = await import(/* @vite-ignore */ lazPerfUrl)
const createLazPerf = mod.default
```

`/* @vite-ignore */` tells Vite not to analyse or bundle this import — it stays as a runtime fetch of the static file from `public/`. Without this comment, Vite will try to process the import at build time and fail.

---

## Final working configuration

```
public/
  lib/
    laz-perf-worker.js    ← patched: WorkerGlobalScope check + ESM named re-export
    laz-perf-worker.wasm  ← worker build output (ENVIRONMENT_IS_WORKER=true)

vite.config.ts:
  optimizeDeps.exclude: ['laz-perf']   ← prevents Vite pre-bundling the npm package
  worker.format: 'es'                  ← production only; dev is always ESM regardless
```

---

## Key constraints (do not regress)

- **NEVER** use `importScripts()` for laz-perf — unavailable in Vite dev module workers
- **NEVER** edit `public/lib/laz-perf-worker.js` directly — rebuild from fork and re-patch
- **NEVER** use `?url` imports for files that need `dynamic import()` inside workers
- **ALWAYS** pass `locateFile` override to `createLazPerf()` — without it WASM fetch fails
- **ALWAYS** use `/* @vite-ignore */` on dynamic imports of external URLs in workers
- **ALWAYS** derive laz-perf URLs from `window.location.origin` on the main thread

---

## Remaining work

- Fork `hobuinc/laz-perf` on GitHub and reference the fork in CLAUDE.md and package docs. Currently using a locally built copy only.

---

## See also

- [[Decoder Workers]] — how the patched laz-perf is used in the worker pool
- [[HTTP/2 Range Requests]] — the `cache: 'no-store'` requirement that also applies to worker fetches
