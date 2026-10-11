## 1.6.0 — 2026-10-10

Extension sockets, Phase 1 (all `@experimental`, all opt-in — a session that
uses none of them behaves as in 1.5.0).

### Added
- **Session surface** on `ManifestSession`: `seedsReady` (resolves once global
  chunk indices are final, before `onSeedsReady` runs), `getSeeds()`,
  `chunkCount`, `tiles` (`TileInfo`: url, header, chunk range, seed count,
  status, error), `resolveChunk(globalIndex)`, and `holdDispatch()` — a
  ref-counted pause of camera-driven dispatch (also on `StreamingEngine`).
- **Exact coordinates:** surfacing `xyz` (`demandFields(['xyz'], { surface: true })`)
  returns `ChunkAttributes.xyzRaw`, the LAS integers as `Int32Array`. No new
  `LasField`; IDB cache keys are unchanged.
- **Decoded-chunk tap:** `session.subscribeDecoded(listener, { fields })`,
  multicast alongside `onChunkDecoded`; `fields` registers a surfacing demand
  released on `unsubscribe()`.
- **LAS directory:** `readLasDirectory(url, opts)` and
  `session.getDirectory(tileIndex, opts)` / `StreamingEngine.getDirectory()` —
  raw header fields (`LasHeaderRaw`) and VLR / EVLR records (`RawVlr`).
  Reports rather than throws on LAS 1.0/1.1 and uncompressed files
  (`streamable: false` + `warnings`). Header + VLR bytes only; EVLRs on request.
- Exports: `TileInfo`, `DecodedChunkSubscription`, `DispatchHold`,
  `LasDirectory`, `LasDirectoryOptions`, `LasHeaderRaw`, `RawVlr`, `LasCompression`.

### Fixed
- A throwing `onChunkDecoded` callback no longer stalls the worker that
  decoded the chunk (it previously stayed idle for the rest of the load) or
  skips engine bookkeeping. The error is logged and reported via `onWarning`.
- `ManifestSession`: a tile that seeded and then failed (e.g. worker init)
  was counted as settled twice, recomputing offsets and firing
  `onSeedsReady` a second time. It now settles once and is marked `failed`
  in `tiles`.

### Changed
- Each tile keeps its header + VLR bytes (typically 8 KB, at most 1 MB) for
  `getDirectory()`.
- `demandFields(['xyz'], { surface: true })` previously surfaced nothing; it
  now returns `xyzRaw`.

## 1.5.0 — 2026-10-04

### Added
- **Field masks and selective layer fetch** (LAZ 1.4 layered files, PDRF 6–10,
  compressor 3, fixed-size chunks). `fetchFields: 'all' | 'render' | LasField[]`
  on `StreamingEngineOptions` / `ManifestSessionOptions`. Only the compressed
  layers the mask needs are range-read and rewritten into a compact chunk the
  stock laz-perf build decodes; skipped layers' bytes are never fetched.
  Default `'all'` keeps whole-chunk fetches.
- `LasField`, `FIELDS_ALL`, `FIELDS_RENDER`, `fieldsInFormat()` exports.
- `demandFields(fields, { surface })` on `StreamingEngine` and `ManifestSession`:
  anonymous, ref-counted field demands that grow the effective mask at runtime.
  `getFieldMask()` and the `onFieldsChanged` event report the effective mask.
- `DecodedChunk.fieldsPresent` (fields with valid data — a field outside it is a
  plausible constant), `DecodedChunk.attributes` (`ChunkAttributes`: raw
  intensity, returns, flags, scan angle, user data, point source ID, GPS time,
  NIR, extra bytes, surfaced on demand) and `DecodedChunk.isUpgrade`.
- `upgradeChunks(indices)`: tops already-decoded chunks up to the current mask,
  fetching only the missing layers when a compact base is held (IDB variant or
  the new in-memory store, `topUpMemoryBytes`, default 64 MB). Re-emits via
  `onChunkDecoded` with `isUpgrade: true`.
- `makeCacheKey(url, chunkIndex, offset, variant?)` and `ChunkCache.has(key)`.
  Compact chunks are cached under a mask variant key; the no-variant key still
  holds only full chunk bytes.
- `onStats` gains `bytesFetched` / `bytesSkipped`.
- `selectiveMaxGapBytes` option (default 8192).
- Unit and engine tests (vitest) with laspy fixtures; CI runs `pnpm -r test`.

### Changed
- Seed requests on layered files with fixed-size chunks are 4 + 4L bytes longer
  (L = layer count) so they return each chunk's layer table with no extra round
  trip. All other default-path requests and worker output are unchanged.

## 1.3.1 — 2026-06-26

### Changed
- Version alignment with `@lazstream/viewer@1.3.1`. No functional changes.
