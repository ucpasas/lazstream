/**
 * @lazstream/core — public API
 *
 * Primary entry point: ManifestSession.
 * For single-file loads: wrap with urlToManifest() first.
 * For multi-tile manifests: fetchManifest() then pass to ManifestSession.
 *
 * StreamingEngine is exported as an advanced/internal API — prefer
 * ManifestSession which handles both single-tile and multi-tile uniformly.
 */

// ── Primary entry point ──────────────────────────────────────────────────────
export { ManifestSession } from './engine/manifest-session.js'
export type { ManifestSessionOptions } from './engine/manifest-session.js'

// ── Manifest types and helpers ───────────────────────────────────────────────
export type { Manifest, TileEntry } from './engine/manifest-types.js'
export { fetchManifest, parseManifest, urlToManifest, ManifestParseError } from './engine/manifest-loader.js'

// ── Lower-level: single-tile engine (advanced use) ───────────────────────────
export { StreamingEngine } from './engine/streaming-engine.js'
export type { EngineEvents, LoadState, RingBufferProvider, StreamingEngineOptions } from './engine/streaming-engine.js'

// ── Provider types — implement these in your renderer ────────────────────────
export type { CameraInfo, ChunkOrdering, VisibilityTest } from './decode/chunk-priority.js'
export type { LazstreamAssetUrls } from './decode/worker-pool.js'

// ── Data types — what flows out of the engine ────────────────────────────────
export type { LasHeader, LazVlr, SeedPoint, ChunkTableEntry, PointDataRecordFormat, LazVersion, PointAttributes } from './types/las.js'
export type { BBox3D } from './types/spatial.js'
export type { DecodedChunk } from './decode/worker-pool.js'

// ── URL validation (for custom manifest fetching pipelines) ──────────────────
export { validateSourceUrl, validateManifestUrl, getEntryFromParams } from './network/url-validator.js'
export type { EntryParam } from './network/url-validator.js'

// ── Utilities ────────────────────────────────────────────────────────────────
export { dequantizeChunk } from './decode/dequantize.js'
export { elevationToRgb } from './decode/color.js'

// ── Optional: IDB cache ──────────────────────────────────────────────────────
export { ChunkCache, makeCacheKey } from './cache/idb-cache.js'
export type { CacheMetrics } from './cache/idb-cache.js'

// ── Errors — for instanceof checks in consumer error handlers ────────────────
export { ParseError } from './engine/header-parser.js'
export { NetworkError, CorsError } from './network/range-fetcher.js'
export { SecurityError } from './network/url-validator.js'
export { ChunkTableError } from './engine/chunk-table.js'

// ── View state sharing ───────────────────────────────────────────────────────
export { encodeViewState, decodeViewState, ViewStateDecodeError } from './share/view-state.js'
export type { ViewState, CameraState } from './share/view-state.js'
