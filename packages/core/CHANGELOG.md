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
