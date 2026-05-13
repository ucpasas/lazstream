---
title: Decoder Workers
type: project
status: active
updated: 2026-05-13
tags: [wasm, laz-perf, workers, decode, pdrf, quantization, transferable]
---

# Decoder Workers

Third stage: `[[Manifest Loader]] → [[Streaming Engine]] → Decoder Workers → [[Renderer]]`.

A pool of Web Workers, each hosting a laz-perf WASM instance. Workers **self-fetch** compressed chunk bytes via HTTP Range request, decode them, quantize XYZ to Int16, and transfer the decoded buffers back to the main thread zero-copy via Transferable ArrayBuffers.

**Phase 2 Track A is complete.** 380 chunks, 18,991,962 points decoded across 4 workers at 76 fps (validation renderer).

---

## Files

| File | Purpose |
|------|---------|
| `src/workers/decode-worker.ts` | Web Worker module: init lifecycle, fetch, WASM decode, quantize, transfer |
| `src/decode/worker-pool.ts` | Main thread: spawns workers, dispatches chunks, routes results, dedup tracking |
| `src/decode/chunk-priority.ts` | Ranks chunks by inverse-distance to camera; produces sorted dispatch order |
| `public/lib/laz-perf-worker.js` | Patched laz-perf WASM JS glue (ESM-patched vendor file — see [[laz-perf Worker Porting]]) |
| `public/lib/laz-perf-worker.wasm` | laz-perf WASM binary (worker build) |

---

## Architecture

### Fetch model: Option A — workers self-fetch

Each worker receives a `decode` message containing `{ url, offset, compressedSize, ... }` and issues its own HTTP Range request. The alternative (main thread fetches, workers decode only) was deferred to Phase 3 when fetch coalescing becomes important.

**Why Option A for Phase 2:** Simpler wiring — no need to pipe byte arrays from main thread through postMessage. Workers already must make network calls; self-fetch avoids a round-trip. Revisit in Phase 3 for [[HTTP/2 Range Requests]] coalescing.

### Worker count cap: 4

```typescript
Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
```

R2 serves over HTTP/1.1 which limits browsers to 6 concurrent connections per origin. 4 workers use 4/6 connections, leaving headroom for other requests. More workers queue behind the connection limit with no throughput benefit. Remove cap when HTTP/2 multiplexing is in place (Phase 3).

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
main thread → { type: 'decode', chunkIndex, url, offset, compressedSize, pointCount,
                 pointDataRecordFormat, pointDataRecordLength, scaleX/Y/Z, offsetX/Y/Z }
   worker → fetch(url, { headers: { Range }, cache: 'no-store' })
   worker → Module.HEAPU8.set(compressedBytes, compressedPtr)
   worker → decoder.open(pdrf, recordLength, compressedPtr)
   worker → loop: decoder.getPoint(pointPtr) → read HEAP32 → apply scale+offset
   worker → quantize XYZ → Int16, compute elevation color → Uint8
   worker → self.postMessage({ positions, colors, ... }, [positions.buffer, colors.buffer])
main thread ← { type: 'decoded', chunkIndex, positions, colors, pointCount, min/max XYZ }
```

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

`WorkerPool` tracks two sets: `inFlight` (currently decoding) and `completed` (done). `requestDecode()` is a no-op if a chunk is in either set — safe to call every frame from the render loop.

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

Before dispatching any chunks, the pool must be configured with the URL, header (for PDRF and scale/offset), and LAZ VLR:

```typescript
pool.configure(url, header, lazVlr)
```

---

## ChunkPrioritiser

`src/decode/chunk-priority.ts` ranks chunks by inverse distance to camera (Phase 2). Phase 3+ will upgrade to screen-space error (SSE):

```
SSE = (geometricError × canvasHeight) / (distance × 2 × tan(fov/2))
```

The `prioritise(cameraWorldX, cameraWorldY, cameraWorldZ, maxResults, excludeDecoded)` method returns chunks sorted highest-priority-first. Camera position is in world coordinates; the prioritiser converts to scene-relative coordinates internally using the scene centre established at seed point load time.

---

## Point data record formats

| PDRF | Version | Decode path | Notes |
|------|---------|-------------|-------|
| 0–5  | 1.2/1.3 | Standard | No selective layer decode |
| 6–10 | 1.4 | Standard (layered decode planned Phase 3) | Layered decode not yet used |

Layered decode (XYZ-only mode skipping colour/classification layers) is planned for Phase 3 as a performance optimization.

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

## Open questions

- [ ] Layered decode (PDRF 6-10): implement XYZ-only skip for initial load pass (Phase 3)
- [ ] Fork laz-perf on GitHub — currently using locally built copy; fork needed for reproducibility
- [ ] Phase 3: move fetch to main thread for HTTP/2 coalescing (Option B fetch model)

---

## See also

- [[laz-perf Worker Porting]] — full discovery log: why the npm package fails, the two patches, Vite dev limitations
- [[Streaming Engine]] — feeds chunk dispatch requests; owns the prioritised decode loop
- [[LAZ Format]] — PDRF definitions, scale/offset coordinate system
- [[Renderer]] — receives decoded point buffers via `onChunkDecoded`
- [[HTTP/2 Range Requests]] — Phase 3 coalescing strategy
- [[Chunk Caching]] — async cache-write after decode (Phase 3)
