/**
 * Socket contract fixture — an external add-on's-eye view of lazstream.
 *
 * Imports ONLY the published entry points of @lazstream/core and
 * @lazstream/viewer (enforced by scripts/ci/check-boundaries.mjs) and resolves
 * them through package.json `exports` — no tsconfig `paths` — so it sees
 * exactly what an npm consumer sees. A socket this file cannot use without
 * private access is not a socket.
 *
 * Type-level coverage of every shipped socket. Each phase of wiki
 * [[Extension Sockets — Implementation Plan]] adds its sockets here; runtime
 * behaviour is tested in packages/core/test/sockets.test.ts.
 *   Phase 0: field demands (core 1.5.0)
 *   Phase 1: C6 session surface, C7 exact xyz, C1 decoded tap, C4 directory (core 1.6.0)
 */
import { ManifestSession, readLasDirectory, urlToManifest } from '@lazstream/core'
import type {
  DecodedChunk, DecodedChunkSubscription, DispatchHold, FieldDemand, LasDirectory,
  LasField, RawVlr, SeedPoint, TileInfo,
} from '@lazstream/core'
import type { LazstreamViewer } from '@lazstream/viewer'

const ADDON_FIELDS: LasField[] = ['gpsTime', 'pointSourceId', 'classification']

/**
 * Settled socket — field demands (core 1.5.0), headless: a session with no
 * renderer, demanding surfaced fields and topping up decoded chunks.
 */
export function headlessFieldDemands(url: string, onChunk: (chunk: DecodedChunk) => void): {
  session: ManifestSession
  demand: FieldDemand
} {
  const session = new ManifestSession(urlToManifest(url), {
    events: { onChunkDecoded: onChunk },
    fetchFields: 'render',
  })
  const demand = session.demandFields(ADDON_FIELDS, { surface: true })
  const mask: ReadonlySet<LasField> = session.getFieldMask()
  if (mask.has('gpsTime')) session.upgradeChunks([0])
  return { session, demand }
}

/**
 * Consumer rule (CLAUDE.md): never read a field outside `fieldsPresent`, and
 * take `isUpgrade` re-emissions (only renderers ignore them).
 */
export function readGpsTime(chunk: DecodedChunk): Float64Array | null {
  if (!chunk.fieldsPresent?.has('gpsTime')) return null
  return chunk.attributes?.gpsTime ?? null
}

/** Shipped single-subscriber hooks on the viewer (multicast is socket C1). */
export function viewerHooks(viewer: LazstreamViewer, onChunk: (chunk: DecodedChunk) => void): FieldDemand {
  viewer.onChunkDecoded = onChunk
  const demand = viewer.demandFields(ADDON_FIELDS, { surface: true })
  viewer.upgradeResidentChunks()
  const session: ManifestSession | null = viewer.session
  session?.getFieldMask()
  return demand
}

/**
 * C6 — session surface: hold dispatch before load, derive a decision from
 * seeds once global indices are final, then release.
 */
export async function seedGatedLoad(url: string): Promise<{ seeds: readonly SeedPoint[]; tiles: readonly TileInfo[] }> {
  const session = new ManifestSession(urlToManifest(url), { events: {} })
  const hold: DispatchHold = session.holdDispatch()
  void session.load()
  await session.seedsReady
  const seeds = session.getSeeds()
  const where = seeds.length > 0 ? session.resolveChunk(seeds[0].chunkIndex) : null
  if (where && session.chunkCount > 0) hold.release()
  return { seeds, tiles: session.tiles }
}

/** C7 — exact LAS integers via xyz surfacing; world = raw × scale + offset. */
export function exactWorldX(chunk: DecodedChunk, tile: TileInfo, i: number): number | null {
  const raw = chunk.attributes?.xyzRaw
  if (!raw || !tile.header) return null
  return raw[i * 3] * tile.header.scaleX + tile.header.offsetX
}

/** C1 — multicast tap with a surfacing demand, released on unsubscribe. */
export function tapExact(session: ManifestSession, onChunk: (chunk: DecodedChunk) => void): DecodedChunkSubscription {
  return session.subscribeDecoded(onChunk, { fields: ['xyz', 'gpsTime'] })
}

/** C4 — raw directory, standalone (batch audit over a URL list) and per tile. */
export async function auditDirectories(urls: string[], session: ManifestSession): Promise<RawVlr[]> {
  const dirs: LasDirectory[] = await Promise.all(urls.map(u => readLasDirectory(u, { includeEvlrs: true })))
  const tile0 = await session.getDirectory(0, { includeData: true, maxRecordBytes: 65536 })
  return [...dirs.flatMap(d => (d.streamable ? d.vlrs : [])), ...tile0.vlrs]
}
