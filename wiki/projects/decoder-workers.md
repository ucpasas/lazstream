---
title: Decoder Workers
type: project
status: active
updated: 2026-05-22
tags: [wasm, laz-perf, workers, decode, pdrf, quantization, transferable]
---

# Decoder Workers

Third stage: `[[Manifest Loader]] → [[Streaming Engine]] → Decoder Workers → [[Renderer]]`.

A pool of Web Workers, each hosting a laz-perf WASM instance. The main thread fetches compressed chunk bytes via HTTP Range request and **transfers** them to an idle worker. Workers are pure WASM decoders — no network I/O. Each worker decodes, quantizes XYZ to Int16, and transfers results back zero-copy via Transferable ArrayBuffers.

**Phase 2 Track A is complete.** 380 chunks, 18,991,962 points decoded across 4 workers at 76 fps (validation renderer).

---

## Files

| File | Purpose |
|------|---------|
| `src/workers/decode-worker.ts` | Web Worker module: init lifecycle, fetch, WASM decode, quantize, transfer |
| `src/decode/worker-pool.ts` | Main thread: spawns workers, dispatches chunks, routes results, dedup tracking |
| `src/decode/chunk-priority.ts` | Ranks undecoded chunks by SSE (screen-space error), frustum-gated; produces sorted dispatch order |
| `public/lib/laz-perf-worker.js` | Patched laz-perf WASM JS glue (ESM-patched vendor file — see [[laz-perf Worker Porting]]) |
| `public/lib/laz-perf-worker.wasm` | laz-perf WASM binary (worker build) |

---

## Architecture

### Fetch model: Option B — main-thread fetches, workers decode only (Phase 3 Track A Step 3)

The engine fetches compressed chunk bytes on the main thread (via coalesced range requests) and hands them to `requestDecode(chunkIndex, chunk, compressedBytes)`. Workers receive only pre-fetched bytes — no network I/O in workers.

**Why Option B:** Enables [[HTTP/2 Range Requests]] coalescing. To coalesce adjacent chunks into one range request, the fetcher must see all pending chunks at once — impossible if each worker fetches independently. Moving fetch to the main thread centralises the coalesce decision, decouples fetch concurrency from decode concurrency, and eliminates the HTTP/1.1 connection-limit constraint on worker count.

### Worker count cap: 100

```typescript
Math.min(100, Math.max(1, navigator.hardwareConcurrency - 1))
```

Workers are pure WASM decoders — no network I/O. The connection-limit rationale for capping at 4 no longer applies. 100 is a high ceiling; in practice machines saturate at `hardwareConcurrency - 1`. Configurable via `?workerCount=N`.

### laz-perf loading: dynamic import from `public/lib/`

The npm package `laz-perf@0.0.7` cannot be used in workers — it asserts `ENVIRONMENT_IS_WORKER=false`. The solution is a custom-built, ESM-patched vendor file loaded via dynamic `import()`. See [[laz-perf Worker Porting]] for the full discovery log and patch details.

```typescript
// worker-pool.ts — derive URLs from window.location.origin, NOT ?url imports
const lazPerfWorkerUrl = `${window.location.origin}/lib/laz-perf-worker.js`
const lazPerfWasmUrl   = `${window.location.origin}/lib/laz-perf-worker.wasm`
```

Files in `public/lib/` are served as static assets without Vite transformation. This bypasses Vite's module interception, which strips exports from dynamically-imported files inside workers.

---

## Worker lifecycle

### Init phase

```
main thread → { type: 'init', lazPerfUrl, lazPerfWasmUrl }
   worker → dynamic import(lazPerfUrl)   /* @vite-ignore */
   worker → createLazPerf({ locateFile: ... })
   worker → new Module.ChunkDecoder()
   worker → Module._malloc(128)           // point record scratch buffer
   worker → { type: 'ready' }
main thread ← ready
```

The `locateFile` override is mandatory — without it laz-perf resolves `.wasm` relative to the worker bundle URL (wrong path), not the location of `laz-perf-worker.js`.

### Decode phase

```
main thread → { type: 'decode', chunkIndex, compressedBytes, pointCount,
                 pointDataRecordFormat, pointDataRecordLength, scaleX/Y/Z, offsetX/Y/Z,
                 globalMinZ, globalMaxZ }
   worker → Module.HEAPU8.set(compressedBytes, compressedPtr)   // bytes already fetched
   worker → decoder.open(pdrf, recordLength, compressedPtr)
   worker → loop: decoder.getPoint(pointPtr) → read HEAP32 → apply scale+offset
   worker → quantize XYZ → Int16, compute elevation color → Uint8 (using globalMinZ/maxZ)
   worker → self.postMessage({ positions, colors, ... }, [positions.buffer, colors.buffer])
main thread ← { type: 'decoded', chunkIndex, positions, colors, pointCount, min/max XYZ, decodeMs }
```

`compressedBytes` is transferred (zero-copy Transferable) — the ArrayBuffer is detached on the main-thread side after `postMessage`.

---

## Int16 quantization scheme

Points are quantized per-chunk to Int16 to minimize transfer bandwidth. The chunk's local bounding box is computed first, then each coordinate is mapped to `[-32768, 32767]`:

```typescript
positions[i * 3] = Math.round(((rawX[i] - minX) / rangeX) * 65535 - 32768)
```

**Dequantization** (in renderer):
```typescript
const wx = ((q + 32768) / 65535) * rangeX + minX
```

The min/max bounding box for each axis is transmitted alongside the positions buffer so the renderer can invert the transform. `rangeX = maxX - minX || 1` guards against flat/degenerate chunks.

---

## WorkerPool — main thread side

### Deduplication

`WorkerPool` tracks two sets: `inFlight` (currently decoding) and `completed` (done). `requestDecode()` is a no-op if a chunk is in either set.

`isKnown(chunkIndex)` is a new Phase 3 Track A method — returns `true` if the chunk is anywhere in the pipeline: completed, in flight, or queued. The engine calls this before fetching to avoid wasted network I/O:

```typescript
if (this.workerPool.isKnown(item.chunkIndex)) continue
```

`isInFlight()` alone missed queued chunks, causing re-fetches for chunks already waiting for a worker slot.

### Queue

When all workers are busy, incoming `requestDecode()` calls push to `this.queue`. On each `decoded` or `error` response, the now-idle worker immediately pulls the next item from the queue.

### Events API

```typescript
new WorkerPool({
  onChunkDecoded: (chunk: DecodedChunk) => void,
  onWorkerError:  (chunkIndex: number, message: string) => void,
  onReady:        () => void,
})
```

### `configure()` call

Before dispatching any chunks, the pool must be configured with the header (for PDRF, scale/offset, global Z range) and LAZ VLR. URL is no longer required — the pool doesn't fetch.

```typescript
pool.configure(header, lazVlr)
```

---

## ChunkPrioritiser

`src/decode/chunk-priority.ts` ranks chunks by **screen-space error (SSE)** — Phase 3 Track C.

```
SSE = (chunkExtent × canvasHeight) / (distance × 2 × tan(fovY/2))
```

Chunks below `MIN_SSE_THRESHOLD` (default 50.0, tunable via `?sseMin=N`) are excluded entirely — seed point is the correct representation at that zoom level. Above the threshold, chunks are sorted SSE-descending and the top `slots` are dispatched per `updateCamera()` tick.

```typescript
// Engine calls:
prioritiser.prioritise(frustumBBox: BBox3D, camera: CameraInfo, maxResults: number)
// Returns PrioritisedChunk[] — { chunkIndex, sse }, sorted sse descending
```

Camera and frustum are provided by the renderer via registered providers (Track C); `updateCamera()` is argless. The prioritiser queries `SpatialIndex.queryFrustum()` for the initial visible set, then scores each visible undecoded chunk by SSE.

---

## Point data record formats

| PDRF | Version | Decode path | Notes |
|------|---------|-------------|-------|
| 0–5  | 1.2/1.3 | Standard | No selective layer decode |
| 6–10 | 1.4 | Standard | laz-perf decodes all bytes; worker reads only needed offsets (XYZ, RGB) |

Selective layer decode (XYZ-only mode bypassing laz-perf colour/classification layers) is not implemented. laz-perf 0.0.7 does not expose a layered API. The worker already reads only the byte offsets it needs from the fully-decoded point record — no laz-perf API change is required for per-attribute selection.

---

## Worker count vs fetch concurrency (Phase 3 Track A)

With Option B, worker count and fetch concurrency are independent:
- **Worker count** = CPU/WASM decode parallelism. Cap: `Math.min(100, hardwareConcurrency - 1)`.
- **Fetch concurrency** = `maxFetches = min(workerCount × 4, 128)` concurrent main-thread range requests. Configurable via `?maxFetches=N`.

The engine's `fetching: Set<number>` tracks in-flight fetches. A chunk is claimed in `fetching` synchronously before any `await` in `updateCamera()`, preventing duplicate dispatches on concurrent frame ticks.

---

## Constraints

- **NEVER** run decode on the main thread.
- **NEVER** use `importScripts()` for laz-perf — unavailable in Vite dev module workers.
- **NEVER** use `?url` imports for files that need `dynamic import()` inside workers — Vite strips exports.
- **NEVER** edit `public/lib/laz-perf-worker.js` directly — rebuild from the patched fork.
- **ALWAYS** pass `locateFile` override to `createLazPerf()` — without it WASM fetch uses wrong path.
- **ALWAYS** use `/* @vite-ignore */` on dynamic imports of external URLs in workers.
- **ALWAYS** derive laz-perf URLs from `window.location.origin` on the main thread.
- **ALWAYS** transfer buffers (not copy) between worker and main thread.

---

## Phase 2 result

| Metric | Value |
|--------|-------|
| Chunks decoded | 380 |
| Points decoded | 18,991,962 |
| Workers | 4 |
| FPS (validation renderer) | 76 |
| Transfer method | Transferable ArrayBuffer (zero-copy) |

---

## Discovery 3: Per-chunk colour normalisation causes block artifacts

**Problem:** The elevation colour ramp was computed per-chunk using `(rawZ - chunkMinZ) / chunkRangeZ`. Adjacent flat chunks with slightly different Z ranges produce visually distinct colours, creating rectangular block artifacts at every chunk boundary — even when the terrain is continuous.

**Root cause:** Per-chunk normalisation resets the colour ramp at every chunk boundary. A flat agricultural field at 143.0–143.3 m and the adjacent chunk at 142.8–143.1 m each map their local range to full 0–1, so they render as identical mid-ramp colours despite having slightly different elevations.

**Fix:** Pass `globalMinZ` and `globalMaxZ` from the LAS header (already parsed, world-space doubles) through the worker pool dispatch message to the decode worker. Use global range for colour only — quantization remains per-chunk:

```typescript
// worker-pool.ts dispatch():
globalMinZ: this.header.minZ,
globalMaxZ: this.header.maxZ,

// decode-worker.ts colour loop:
const globalRangeZ = req.globalMaxZ - req.globalMinZ || 1
const t = (rawZ[i] - req.globalMinZ) / globalRangeZ
```

**Note:** `header.minZ` / `header.maxZ` are world-space doubles (IEEE 754, LAS spec §2.4). Do NOT apply scale/offset — they are already in metres.

**Verified:** Block artifacts eliminated on Texas tile after fix. Colour now continuous across chunk boundaries.

**Remaining gap:** Giro3D applies histogram equalisation or local contrast enhancement on top of global normalisation, giving more dramatic colour variation on low-relief tiles. This is a future enhancement, not a bug.

---

## Pipeline timing instrumentation (2026-05-20)

`decodeMs` field added to `DecodedChunk` (and the `decoded` worker message). The worker records `performance.now()` at the start of `decodeChunk()` and includes the elapsed ms in the postMessage. The renderer accumulates and logs every 25 chunks:

```
[lazstream/timing] last 25 chunks — decode avg 56.4 ms  pack avg 0.54 ms
```

**Observed (Melbourne PDRF 6, ~75K pts/chunk, 15 workers):** decode ≈ 56 ms/chunk, pack ≈ 0.5 ms/chunk. With 15 workers: effective decode throughput ~266 chunks/sec → 134 chunks (10M pts) decodes in ~500ms. The 10–11 second loads observed are network-bound (40MB compressed at ~3–5 MB/s to R2), not GPU-bound. See [[COPC vs Raw LAZ]] for architecture context.

---

## Per-point RGB color reading (2026-05-20)

For PDRFs that carry per-point RGB, the decoded bytes are already in the WASM heap after each `decoder.getPoint()` call. The decode worker now reads them directly via `Module.HEAPU16` (uint16 per channel, right-shifted 8 bits to uint8):

| PDRF | Version | RGB byte offset | Notes |
|------|---------|-----------------|-------|
| 2    | 1.2     | 20              | No GPS time; RGB follows point source ID |
| 3    | 1.2     | 28              | GPS time (8 bytes) precedes RGB |
| 5    | 1.2     | 28              | PDRF 3 + waveform; same RGB offset as PDRF 3 |
| 7    | 1.4     | 30              | PDRF 6 (30 bytes) + RGB |
| 8    | 1.4     | 30              | PDRF 7 + NIR (2 bytes after RGB) |
| 10   | 1.4     | 30              | PDRF 7 + waveform; same RGB offset as PDRF 7 |

All other PDRFs (0, 1, 4, 6, 9) fall back to elevation coloring.

**Reading pattern** (in `decode-worker.ts`):
```typescript
rawR[i] = Module.HEAPU16[(pointPtr + rgbByteOffset    ) >> 1] >> 8
rawG[i] = Module.HEAPU16[(pointPtr + rgbByteOffset + 2) >> 1] >> 8
rawB[i] = Module.HEAPU16[(pointPtr + rgbByteOffset + 4) >> 1] >> 8
```

`>> 1` converts byte offset to Uint16Array index; `>> 8` scales LAS full-range uint16 to uint8.

RGB is collected in the first pass (alongside XYZ bounding box) and applied in the second pass (quantization + color packing). No second decode required.

No C++ or laz-perf changes needed — laz-perf already decoded these bytes.

---

## Open questions

- [x] **Read actual PDRF 7/8/10 RGB colors** — **Shipped 2026-05-20.** laz-perf decodes all bytes; decode-worker now reads RGB from the WASM heap during the first decode pass and uses it instead of elevation coloring for PDRFs 2/3/5/7/8/10. See RGB byte offsets section below.
- [x] Fork laz-perf — **local fork exists at `/home/kisar/src/laz-perf`** (clone of `hobuinc/laz-perf`, two local modifications: `js/wasm.sh` calls the patch script post-build; `js/patch-worker-esm.py` applies the two ESM patches). Still needs pushing as a public GitHub fork for reproducibility, but the build is locally reproducible.

---

## See also

- [[laz-perf Worker Porting]] — full discovery log: why the npm package fails, the two patches, Vite dev limitations
- [[Streaming Engine]] — feeds chunk dispatch requests; owns the prioritised decode loop
- [[LAZ Format]] — PDRF definitions, scale/offset coordinate system
- [[Renderer]] — receives decoded point buffers via `onChunkDecoded`
- [[HTTP/2 Range Requests]] — Phase 3 coalescing strategy
- [[Chunk Caching]] — async cache-write after decode (Phase 3)
