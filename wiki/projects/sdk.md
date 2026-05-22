---
title: SDK Extraction — @lazstream/core + @lazstream/viewer
type: project
status: planned
updated: 2026-05-23
tags: [sdk, monorepo, core, viewer, worker, portability, api-design, manifest]
---

# SDK Extraction — `@lazstream/core` + `@lazstream/viewer`

## Goal

Extract the renderer-agnostic engine layer into a portable npm package (`@lazstream/core`) so that developers can stream LAZ files — single files or multi-tile manifests — into any 3D framework, and ship a separate `@lazstream/viewer` package that wraps the full WebGPU viewer as a one-liner embed.

**Primary driver:** Developer ease of integration. The API must be self-explanatory from TypeScript types alone — a consumer should not need to read the wiki to get started.

---

## Manifest context (what changed since this plan was drafted)

`ManifestSession` is now implemented and is the top-level coordinator in `main.ts`. This changes the SDK design in one important way: **the recommended external API is `ManifestSession`, not `StreamingEngine` directly.**

- `urlToManifest(url)` wraps a bare `.laz` URL in a synthetic one-tile manifest — single-file and multi-tile load paths are identical from the caller's perspective.
- `ManifestSession` exposes the same provider-registration and dispose API as `StreamingEngine`.
- `StreamingEngine` is still exported as an advanced API but is no longer the primary entry point.

The manifest types (`Manifest`, `TileEntry`), parser (`parseManifest`), loader (`fetchManifest`), and validator (`validateManifestUrl`) are all part of `@lazstream/core`'s public surface.

---

## Current blockers (why this can't ship today)

Two concrete issues prevent extracting a portable package from the current single-Vite-app layout:

1. **`?worker` Vite import in `worker-pool.ts`** — non-portable to webpack 5, Rollup, Next.js, or native ESM.
2. **Hardcoded `window.location.origin` for laz-perf assets** — forces every consumer to host files at `/lib/` on their exact origin.

Everything else (engine, decode, network, cache, manifest, types) is already renderer-agnostic.

---

## Target integration API

### `@lazstream/core` — single file

```typescript
import { ManifestSession, urlToManifest, dequantizeChunk } from '@lazstream/core'

const session = new ManifestSession(urlToManifest('https://cdn.example.com/scan.laz'), {
  events: {
    onSeedsReady(seeds, header) {
      // seeds: SeedPoint[] — world XYZ, one per chunk, instant overview
      // header: LasHeader — merged bounds, scale, PDRF, version
      myRenderer.initScene(header)
      myRenderer.addSeeds(seeds)
    },
    onChunkDecoded(chunk) {
      // chunk.positions — Int16Array, quantized per-chunk-local coords
      // chunk.colors    — Uint8Array, RGBA (RGB or elevation ramp)
      const worldXYZ = dequantizeChunk(chunk)   // Float32Array [x,y,z, ...]
      myRenderer.addChunk(chunk.chunkIndex, worldXYZ, chunk.colors)
    },
    onStateChange(state, message) { updateUI(state, message) },
    onProgress(loaded, total, phase) { updateProgressBar(loaded / total) },
    onWarning(message) { console.warn(message) },
    onError(err) { showError(err.message) },
  }
})
```

### `@lazstream/core` — multi-tile manifest

```typescript
import { ManifestSession, fetchManifest, dequantizeChunk } from '@lazstream/core'

// fetchManifest validates + parses a .lazm.json at the given URL
const manifest = await fetchManifest('https://cdn.example.com/survey.lazm.json')

const session = new ManifestSession(manifest, { events: { ... } })
```

### Wiring providers and starting the loop (same for both)

```typescript
// Tell the session where your camera is (pulled each frame)
session.setCameraProvider(() => ({
  worldX: camera.position.x,
  worldY: camera.position.y,
  worldZ: camera.position.z,
  fovY: camera.fov * (Math.PI / 180),
  canvasHeight: canvas.height,
}))

// Tell the session what's visible (frustum as world-space AABB)
session.setFrustumProvider(() => ({
  minX: bbox.min.x, maxX: bbox.max.x,
  minY: bbox.min.y, maxY: bbox.max.y,
  minZ: bbox.min.z, maxZ: bbox.max.z,
}))

// Back-pressure: tell the session how much GPU memory is free
session.setRingBufferProvider(() => ({
  slotsFree: myRenderer.freeSlots,
  slotsTotal: myRenderer.totalSlots,
}))

// Eviction callback: when your renderer drops a chunk, tell the session
myRenderer.onChunkEvicted = chunkIndex => session.onChunkEvictedFromGPU(chunkIndex)

await session.load()

// Call every frame from your render loop
function renderLoop() {
  session.updateCamera()
  myRenderer.render()
  requestAnimationFrame(renderLoop)
}
requestAnimationFrame(renderLoop)
```

### `@lazstream/viewer` — one-liner embed

```typescript
import { LazstreamViewer } from '@lazstream/viewer'

const viewer = await LazstreamViewer.create(canvas)

// Accepts a bare LAZ URL, a .lazm.json URL, or a pre-parsed Manifest object
await viewer.load('https://cdn.example.com/scan.laz')
await viewer.load('https://cdn.example.com/survey.lazm.json')
await viewer.load(preloadedManifest)
// done — viewer handles session, workers, WebGPU, camera, ring buffer, everything
```

---

## Repository structure (after migration)

```
lazstream/
├── package.json               ← workspace root (pnpm workspaces)
├── pnpm-workspace.yaml
├── packages/
│   ├── core/                  ← @lazstream/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── index.ts       ← all public exports
│   │       ├── engine/        ← streaming-engine, manifest-session, manifest-loader,
│   │       │                     manifest-types, header-parser, chunk-table, spatial-index
│   │       ├── decode/        ← worker-pool, chunk-priority, dequantize (new), color (new)
│   │       ├── workers/       ← decode-worker (separate build entry)
│   │       ├── network/       ← range-fetcher, url-validator, batch-fetcher
│   │       ├── cache/         ← idb-cache
│   │       └── types/         ← las.ts, spatial.ts
│   └── viewer/                ← @lazstream/viewer
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── index.ts       ← viewer public exports
│           ├── viewer.ts      ← LazstreamViewer wrapper (new)
│           ├── render/        ← webgpu-renderer, ring-buffer, shaders, etc.
│           └── main.ts        ← demo app entry (unchanged in behaviour)
└── wiki/
```

---

## Implementation steps

### Step 1 — New file: `decode/dequantize.ts`

Pure utility, no dependencies. Exports `dequantizeChunk(chunk: DecodedChunk): Float32Array`.

The Int16 quantization maps chunk-local `[min, max]` → `[-32768, 32767]`. Inverse:
```
world = (q + 32768) / 65535 * range + min
```

Every custom renderer consumer needs this immediately. Done first because it is zero-risk and immediately useful.

---

### Step 2 — New file: `decode/color.ts`

Move `elevationToRgb()` out of `decode-worker.ts` (where it lives as a duplicate, copied because workers couldn't import main-thread modules). With the new build where the decode-worker is a separate Rollup entry, it CAN import from sibling files — Rollup inlines them at build time.

Update imports in:
- `decode-worker.ts` → `import { elevationToRgb } from './color.js'`
- `render/point-packing.ts` → same import (eliminates its own inline copy)

---

### Step 3 — Worker portability: replace `?worker` import

**File:** `decode/worker-pool.ts`

Replace:
```typescript
import DecodeWorkerFactory from '../workers/decode-worker.ts?worker'
const worker = new DecodeWorkerFactory()
```

With:
```typescript
const DEFAULT_WORKER_URL = new URL('./decode-worker.js', import.meta.url)
const worker = new Worker(this.options?.workerUrl ?? DEFAULT_WORKER_URL, { type: 'module' })
```

`new URL('./decode-worker.js', import.meta.url)` is the portable worker pattern. Supported natively by Vite, webpack 5, Rollup, and modern browsers. No bundler plugin needed.

Add `LazstreamAssetUrls` interface:

```typescript
/**
 * Override URLs for lazstream's bundled worker and WASM assets.
 * Only needed if your build tooling serves files from a non-standard location
 * (e.g., CDN prefix, custom asset hash). Leave unset for standard setups.
 */
export interface LazstreamAssetUrls {
  /** URL of decode-worker.js. Defaults to './decode-worker.js' relative to this package. */
  workerUrl?: URL | string
  /** URL of laz-perf-worker.js. Defaults to location next to the worker. */
  lazPerfJsUrl?: URL | string
  /** URL of laz-perf-worker.wasm. Defaults to location next to the JS. */
  lazPerfWasmUrl?: URL | string
}
```

`{ type: 'module' }` is required — the decode worker uses dynamic `import()` for laz-perf. Supported: Chrome 80+, Firefox 114+, Safari 15+.

---

### Step 4 — Simplify laz-perf URL loading in the worker

**File:** `workers/decode-worker.ts`

Currently receives `lazPerfUrl` + `lazPerfWasmUrl` via the init message (derived from `window.location.origin` in worker-pool). With the new layout, both JS and WASM files are in the same `dist/` as the worker — the worker derives them from its own `import.meta.url`:

```typescript
// In init handler, instead of using msg.lazPerfUrl:
const lazPerfUrl     = new URL('./laz-perf-worker.js',   import.meta.url).href
const lazPerfWasmUrl = new URL('./laz-perf-worker.wasm', import.meta.url).href
```

If `assetUrls.lazPerfJsUrl` was set by the pool (CDN case), that is forwarded via the init message and takes precedence.

**Remove from `worker-pool.ts`** (the two hardcoded lines):
```typescript
// DELETE:
const lazPerfWorkerUrl = `${window.location.origin}/lib/laz-perf-worker.js`
const lazPerfWasmUrl   = `${window.location.origin}/lib/laz-perf-worker.wasm`
```

---

### Step 5 — `StreamingEngine` constructor: options object

Switch from 5 positional params to a single options object. This is a breaking change at the SDK boundary, but the right moment to do it before publication.

```typescript
export interface StreamingEngineOptions {
  /** Callbacks for all engine events. At minimum: onSeedsReady + onChunkDecoded. */
  events: EngineEvents
  /** Decode worker count. Default: hardwareConcurrency - 1 (max 100). */
  workerCount?: number
  /** IndexedDB cache for compressed chunks. Default: disabled. */
  cache?: ChunkCache | null
  /** Minimum screen-space error to trigger chunk decode. Default: 50.0. */
  sseThreshold?: number
  /** Max concurrent HTTP range requests. Default: min(workerCount × 4, 128). */
  maxFetches?: number
  /** Asset URL overrides — only for non-standard hosting. */
  assetUrls?: LazstreamAssetUrls
}

constructor(options: StreamingEngineOptions)
```

**Effect on `ManifestSessionOptions`:** Once `StreamingEngineOptions` exists, `ManifestSessionOptions` collapses cleanly to:

```typescript
export interface ManifestSessionOptions extends Omit<StreamingEngineOptions, 'events'> {
  events: EngineEvents
}
```

This is the originally intended form — the intermediate definition (`workerCount?`, `sseThreshold?`, `maxFetches?` listed by hand) can be removed. The `ManifestSession` `load()` method unpacks these and passes them to each `new StreamingEngine(options)` call.

---

### Step 6 — `packages/core/src/index.ts` — public API surface

Everything exported here is part of the public API and must have JSDoc.

```typescript
// ── Primary entry point ─────────────────────────────────────────────────────
export { ManifestSession } from './engine/manifest-session.js'
export type { ManifestSessionOptions } from './engine/manifest-session.js'

// ── Manifest types and helpers ──────────────────────────────────────────────
export type { Manifest, TileEntry } from './engine/manifest-types.js'
export { fetchManifest, parseManifest, urlToManifest, ManifestParseError } from './engine/manifest-loader.js'

// ── Lower-level: single-tile engine (advanced use) ──────────────────────────
export { StreamingEngine } from './engine/streaming-engine.js'
export type { EngineEvents, LoadState, RingBufferProvider, StreamingEngineOptions } from './engine/streaming-engine.js'

// ── Provider types — implement these in your renderer ───────────────────────
export type { CameraInfo } from './decode/chunk-priority.js'
export type { LazstreamAssetUrls } from './decode/worker-pool.js'

// ── Data types — what flows out of the engine ───────────────────────────────
export type { LasHeader, LazVlr, SeedPoint, ChunkTableEntry, PointDataRecordFormat, LazVersion } from './types/las.js'
export type { BBox3D } from './types/spatial.js'
export type { DecodedChunk } from './decode/worker-pool.js'

// ── URL validation (for custom manifest fetching) ───────────────────────────
export { validateSourceUrl, validateManifestUrl, getEntryFromParams } from './network/url-validator.js'
export type { EntryParam } from './network/url-validator.js'

// ── Utilities ────────────────────────────────────────────────────────────────
export { dequantizeChunk } from './decode/dequantize.js'
export { elevationToRgb } from './decode/color.js'

// ── Optional: IDB cache ──────────────────────────────────────────────────────
export { ChunkCache, makeCacheKey } from './cache/idb-cache.js'
export type { CacheMetrics } from './cache/idb-cache.js'

// ── Errors — for instanceof checks in error handlers ────────────────────────
export { ParseError } from './engine/header-parser.js'
export { NetworkError, SecurityError } from './network/range-fetcher.js'
export { ChunkTableError } from './engine/chunk-table.js'
```

**Deliberately NOT exported:** `ChunkPrioritiser`, `SpatialIndex`, `WorkerPool`, `fetchRange`, `coalesce`, `RingBufferAllocator` — all internal.

Note: `validateSourceUrl` and `validateManifestUrl` are exported because consumers building custom manifest-fetch pipelines need them. The security boundary is real; don't leave consumers to reimplement it.

---

### Step 7 — `packages/core/vite.config.ts` — library build

```typescript
import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({ include: ['src/index.ts'], rollupTypes: true }),
    // rollupTypes: true merges all .d.ts into a single dist/index.d.ts
  ],
  build: {
    lib: {
      entry: {
        index:          resolve(__dirname, 'src/index.ts'),
        'decode-worker': resolve(__dirname, 'src/workers/decode-worker.ts'),
        // Two entries: index.js (what consumers import) +
        // decode-worker.js (loaded via new Worker(...) at runtime)
      },
      formats: ['es'],
    },
    rollupOptions: {
      // laz-perf is a runtime fetch inside the worker, not a bundled import
    },
    copyPublicDir: false,
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['laz-perf'] },
})
```

**laz-perf assets in dist:** A postbuild script copies `assets/laz-perf-worker.{js,wasm}` → `dist/` so they sit next to `decode-worker.js`. The worker's `import.meta.url` resolution then finds them correctly.

```json
// packages/core/package.json scripts:
"build": "vite build && node scripts/copy-lazperf.js"
```

---

### Step 8 — `packages/core/package.json`

```json
{
  "name": "@lazstream/core",
  "version": "0.2.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types":  "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "dependencies": {
    "idb-keyval": "6.2.2",
    "rbush-3d":   "0.0.4"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "typescript": "^5.5.0",
    "vite-plugin-dts": "^4.0.0"
  }
}
```

`idb-keyval` and `rbush-3d` are bundled (not peer deps) — both are small (<30 KB total) and niche enough that version conflicts are not a concern. Tree-shaking removes `idb-keyval` if the consumer never passes a `ChunkCache`.

Three.js is NOT a dependency of core.

---

### Step 9 — `packages/viewer/src/viewer.ts` — `LazstreamViewer`

High-level wrapper that wires session + renderer + all providers internally.

```typescript
export interface ViewerOptions {
  ringBufferCapacity?: number  // GPU ring buffer size in bytes. Default: auto (~2 GB).
  sseThreshold?: number        // Min SSE to trigger decode. Default: 50.0.
  workerCount?: number         // Decode worker count. Default: hardwareConcurrency - 1.
  maxFetches?: number          // Max concurrent HTTP requests. Default: min(workers×4, 128).
  splatRadius?: number         // Point splat radius (1=1px, 2=3×3). Default: 1.
  enableCache?: boolean        // IndexedDB chunk cache. Default: true.
  onStateChange?: (state: string, message: string) => void
  onProgress?: (pct: number, phase: string) => void
  onWarning?: (message: string) => void
  onError?: (err: Error) => void
}

export class LazstreamViewer {
  /** Create a viewer attached to a canvas. Throws WebGPUUnsupportedError if WebGPU unavailable. */
  static async create(canvas: HTMLCanvasElement, options?: ViewerOptions): Promise<LazstreamViewer>

  /**
   * Load a point cloud. Accepts:
   *   - A bare .laz URL string   → wrapped in a synthetic one-tile manifest
   *   - A .lazm.json URL string  → fetched and parsed as a multi-tile manifest
   *   - A pre-parsed Manifest    → used directly (you control fetch + validation)
   *
   * Cancels any in-progress load before starting.
   */
  async load(source: string | Manifest): Promise<void>

  /** Stop streaming and release all GPU/worker resources. */
  dispose(): void

  /** Access the underlying session for advanced use (custom providers, etc.). */
  get session(): ManifestSession

  /** Access the underlying renderer (setSplatRadius, getRingBufferStatus, etc.). */
  get renderer(): WebGPURenderer
}
```

**`load()` routing inside the viewer:**

```typescript
async load(source: string | Manifest): Promise<void> {
  let manifest: Manifest
  if (typeof source === 'string') {
    if (source.toLowerCase().endsWith('.lazm.json')) {
      validateManifestUrl(source)
      manifest = await fetchManifest(source)
    } else {
      manifest = urlToManifest(source)   // validates as .laz inside urlToManifest
    }
  } else {
    manifest = source   // pre-parsed, consumer already validated
  }
  // ... create ManifestSession, wire providers, call session.load()
}
```

Passing a pre-parsed `Manifest` object is the advanced path — useful when the consumer is building their own manifest editor or fetching manifests from a signed URL they've already resolved. In that path the viewer skips all URL validation.

`.session` replaces the former `.engine` getter. For consumers who need `StreamingEngine` internals, `session.engines` is accessible but not part of the stable public API.

---

### Step 10 — `packages/viewer/package.json`

```json
{
  "name": "@lazstream/viewer",
  "version": "0.2.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types":  "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "dependencies": {
    "@lazstream/core": "workspace:*"
  },
  "peerDependencies": {
    "three": ">=0.168.0"
  }
}
```

Three.js is a peer dep — large (600 KB+) and universally present in apps that use this viewer.

---

### Step 11 — Workspace root

**`package.json`:**
```json
{
  "name": "lazstream-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":   "pnpm -F @lazstream/viewer dev",
    "build": "pnpm -F @lazstream/core build && pnpm -F @lazstream/viewer build",
    "check": "pnpm -F @lazstream/core check && pnpm -F @lazstream/viewer check"
  }
}
```

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - 'packages/*'
```

During development, `@lazstream/core` resolves to `packages/core/src/index.ts` via the workspace symlink — no build step needed for hot reload in the viewer dev server.

---

### Step 12 — Back-pressure guide for custom renderers

If a consumer uses `@lazstream/core` without a ring buffer, they must register a stub or the engine will buffer unboundedly.

```typescript
// Minimal stub — track loaded chunks manually
let loadedChunks = 0
const MAX_CHUNKS = 500

session.setRingBufferProvider(() => ({
  slotsFree: Math.max(0, MAX_CHUNKS - loadedChunks),
  slotsTotal: MAX_CHUNKS,
}))

// In onChunkDecoded:
loadedChunks++

// When your renderer drops a chunk (e.g. LRU eviction):
loadedChunks--
session.onChunkEvictedFromGPU(chunkIndex)
```

**Multi-tile note:** With a manifest session, `chunkIndex` in `onChunkDecoded` is a globally-namespaced index (tile offset applied). The eviction callback must pass the same global index back to `session.onChunkEvictedFromGPU` — the session routes it to the correct tile engine internally. Consumers never need to think about tile offsets.

Document `onChunkEvictedFromGPU` prominently — without calling it, evicted chunks are never re-decoded when they re-enter view.

---

### Step 13 — Bundler integration guide (wiki)

`wiki/concepts/sdk-integration-guide.md` — covers:

| Bundler | Config needed |
|---------|--------------|
| **Vite** | None — works out of the box |
| **webpack 5** | `{ test: /\.wasm$/, type: 'asset/resource' }` in module.rules |
| **Next.js App Router** | `'use client'` directive + `useEffect` for session creation |
| **Native ESM** | Import map for bare specifiers |

Plus framework-specific integration examples: Three.js `BufferGeometry`, React `useEffect` cleanup, Babylon.js `VertexData`.

Multi-tile example using `fetchManifest`:

```typescript
// React example — multi-tile manifest
useEffect(() => {
  let session: ManifestSession | null = null

  fetchManifest(props.manifestUrl).then(manifest => {
    session = new ManifestSession(manifest, { events: { ... } })
    // wire providers ...
    session.load()
  })

  return () => session?.dispose()
}, [props.manifestUrl])
```

---

## Files changed summary

| File | Change |
|------|--------|
| `src/decode/dequantize.ts` | **New** — `dequantizeChunk()` |
| `src/decode/color.ts` | **New** — `elevationToRgb()` extracted from decode-worker |
| `src/workers/decode-worker.ts` | Derive laz-perf URLs from `import.meta.url`; import from `color.ts` |
| `src/decode/worker-pool.ts` | Replace `?worker`; add `LazstreamAssetUrls`; `new Worker(new URL(...))` |
| `src/engine/streaming-engine.ts` | Constructor → options object; `ManifestSessionOptions` gains clean `Omit<>` form |
| `src/render/point-packing.ts` | Import `elevationToRgb` from `decode/color.ts` |
| `src/engine/manifest-types.ts` | Already exists — move to `packages/core/src/engine/` |
| `src/engine/manifest-loader.ts` | Already exists — move to `packages/core/src/engine/` |
| `src/engine/manifest-session.ts` | Already exists — move to `packages/core/src/engine/`; update `ManifestSessionOptions` to extend `StreamingEngineOptions` |
| `packages/core/src/index.ts` | **New** — public API surface |
| `packages/core/package.json` | **New** |
| `packages/core/vite.config.ts` | **New** — lib build, two entries |
| `packages/viewer/src/viewer.ts` | **New** — `LazstreamViewer` wrapper; `load(string | Manifest)` |
| `packages/viewer/src/index.ts` | **New** — viewer public exports |
| `packages/viewer/package.json` | **New** |
| `package.json` | Convert to workspace root |
| `pnpm-workspace.yaml` | **New** |
| `wiki/concepts/sdk-integration-guide.md` | **New** — bundler configs + framework examples |

---

## Verification

1. `pnpm check` — `tsc --noEmit` across both packages, no errors
2. Load a single `.laz` file in the dev server — confirm `[worker] import result` log fires and all workers reach `ready`
3. Load a `.lazm.json` manifest with two tiles — confirm seeds from both tiles appear, chunks from both decode, no duplicate `chunkIndex` values in `onChunkDecoded` events
4. In browser console after a decode: `dequantizeChunk(chunk)` returns Float32Array with values in `[chunk.minX, chunk.maxX]`
5. Create an isolated HTML page importing only `@lazstream/viewer` — confirm cloud-garden.laz renders
6. `grep -r 'window.location' packages/core/` → empty (no hardcoded origins)
7. `grep -r '?worker' packages/core/` → empty (no Vite-specific imports)
8. Network tab: laz-perf files load from `dist/` with correct MIME types, no 404s
9. Tile failure: create a manifest where tile 1 is a 404 URL — confirm tile 0 still renders and a warning appears, no crash

---

## See also

- [[Manifest Session]] — multi-tile coordinator; primary `@lazstream/core` entry point
- [[Manifest Format]] — `.lazm.json` schema
- [[Decoder Workers]] — current worker architecture, laz-perf porting details
- [[Streaming Engine]] — per-tile engine events API, back-pressure invariants
- [[Ring Buffer GPU Memory]] — ring buffer allocator (stays in viewer package)
- [[Back-Pressure Invariants]] — why `setRingBufferProvider` matters for custom renderers
