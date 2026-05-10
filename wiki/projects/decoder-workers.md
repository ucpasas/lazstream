---
title: Decoder Workers
type: project
status: draft
updated: 2026-05-09
tags: [wasm, laz-perf, workers, decode, pdrf]
---

# Decoder Workers

Third stage: `[[Manifest Loader]] → [[Streaming Engine]] → Decoder Workers → [[Renderer]]`.

A pool of Web Workers, each hosting a laz-perf 0.0.7 WASM instance. Receives compressed chunk bytes, decodes them, and transfers point attribute buffers to the renderer.

---

## Responsibilities

1. Maintain a pool of `N` workers (N = `navigator.hardwareConcurrency`, capped at 8).
2. For each incoming chunk: select an idle worker, post the compressed bytes via `Transferable` (zero-copy).
3. Worker decodes using laz-perf WASM:
   - PDRF 6–10 (LAZ 1.4): use layered decode for full performance.
   - PDRF 0–5 (LAZ 1.2/1.3): standard decode, no selective layer access.
4. Transfer decoded `Float32Array` (XYZ) and optional attribute arrays (intensity, classification, RGB) back to main thread via `Transferable`.
5. Main thread forwards buffers to [[Renderer]] for GPU upload.
6. Write decoded chunk to [[Chunk Caching]] (IndexedDB) asynchronously after transfer.

---

## laz-perf integration

- Version: `laz-perf 0.0.7`
- WASM is loaded once per worker via `importScripts` or `fetch` + `WebAssembly.instantiate`.
- Each worker keeps its own WASM memory — no shared state between workers.
- Layered decode (PDRF 6–10): laz-perf exposes per-layer byte offsets; allows skipping colour/classification layers when only XYZ is needed.

---

## Point data record formats

| PDRF | Version | XYZ | Intensity | RGB | Waveform | Decode path |
|------|---------|-----|-----------|-----|----------|-------------|
| 0–5  | 1.2/1.3 | ✓ | ✓ | 3 only | — | Standard |
| 6–10 | 1.4 | ✓ | ✓ | 7,8,10 | 4,5,9,10 | Layered |

---

## Constraints

- NEVER run decode on the main thread.
- ALWAYS transfer buffers (not copy) between worker and main thread.
- NEVER decode more chunks than the renderer can absorb (back-pressure from [[Streaming Engine]]).

---

## Open questions

- [ ] Should workers be persistent (pooled) or spawned per-chunk? Current plan: persistent pool.
- [ ] Layered decode: which layers to skip by default? XYZ-only mode for initial load?
- [ ] laz-perf 0.0.7 vs a newer fork — any breaking API changes?

---

## See also

- [[Streaming Engine]] — feeds compressed bytes
- [[LAZ Format]] — PDRF definitions
- [[Renderer]] — receives decoded point buffers
- [[Chunk Caching]] — async cache-write after decode
