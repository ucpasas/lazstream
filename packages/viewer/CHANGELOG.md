## 1.6.0 — 2026-10-04

### Added
- `ViewerOptions.fetchFields` and `onFieldsChanged`, passed to the session
  (`@lazstream/core` 1.5.0 field masks).
- `viewer.onChunkDecoded` consumer hook: fires for every decoded chunk after the
  renderer takes it, including upgrade re-emissions.
- `viewer.demandFields(fields, { surface })` — handles stay valid across `load()`.
- `viewer.upgradeResidentChunks()` and `WebGPURenderer.getResidentChunkIndices()`.
- Demo: `?fields=render|all`; with it, `window.lazstreamFields` exposes
  `demandFields` / `upgradeResidentChunks` / `onChunkDecoded` in the dev console.

### Changed
- Upgrade re-emissions (`chunk.isUpgrade`) are never re-added to the renderer.

## 1.5.1 — 2026-10-03

### Changed
- The viewer now opens with a default sample: the Cloud Garden terrestrial scan
  (118.9M points, LAZ 1.4 PDRF 7, Morton-sorted, 441 MB) hosted at
  `data.lazstream.stream`. It is pre-filled in the URL box and loads when Load
  is pressed with the box empty.
- Attribution for the sample is shown bottom-right: Brendan Harmon, LSU Center
  for Computation & Technology, CC0, doi:10.5281/zenodo.15670829.

## 1.5.0 — 2026-09-30

### Fixed
- **GPU out-of-memory on low-VRAM laptop and integrated GPUs no longer fails
  silently.** The ring buffer was sized from the device's addressable limits,
  not from free memory. A failed allocation left invalid buffers behind, which
  caused cascading WebGPU errors and a blank canvas with no message. The
  renderer now allocates inside an `'out-of-memory'` error scope. On failure it
  halves the ring buffer and retries (2 GB → … → 128 MB). A partially
  allocated renderer is never started.
- A `ringBufferCapacity` override above the device's buffer limit is now
  clamped. It used to skip the clamp and produce invalid buffers.
- An explicit voxel pool size can no longer exceed half of a reduced ring buffer.

### Added
- `ViewerOptions.minRingBufferCapacity`: the floor for the out-of-memory
  backoff (default 128 MB).
- `ViewerOptions.onGpuMemoryReduced(budget)`, fired once when the viewer starts
  with a smaller buffer than requested. Also added `viewer.gpuMemoryBudget`.
- `ViewerOptions.onGpuFault(fault)`, fired on runtime GPU out-of-memory or
  device loss. The viewer stops rendering and streaming, and the app decides
  what to show.
- `GpuOutOfMemoryError`, thrown by `LazstreamViewer.create()` when even the
  floor cannot be allocated. `GpuMemoryBudget` and `GpuFault` types are now
  exported.

## 1.3.1 — 2026-06-26

### Fixed
- `CameraState` type is now correctly re-exported from the package root
  (`@lazstream/viewer`). Previously it was exported from `viewer.d.ts` but
  missing from `index.ts`, causing a runtime `SyntaxError` for consumers
  importing it directly from `@lazstream/viewer`.

## 1.3.0 — 2026-06-22

### Added
- `LazstreamViewer.getCameraState()` — returns current camera position and
  look-at target in world coordinates. Returns `null` before seeds are loaded.
- `LazstreamViewer.applyCameraState(state)` — restores camera from a saved
  `CameraState`. Must be called after seeds are loaded (see JSDoc timing note).
- `CameraState` type is now re-exported from `@lazstream/viewer` so consumers
  do not need to import it from `@lazstream/core` directly.

### Fixed
- External consumers (e.g. map-synced split viewers) had no supported path to
  control the camera. This release closes that gap.
