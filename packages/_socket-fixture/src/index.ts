/**
 * Socket contract fixture — an external add-on's-eye view of lazstream.
 *
 * Imports ONLY the published entry points of @lazstream/core and
 * @lazstream/viewer (enforced by scripts/ci/check-boundaries.mjs) and resolves
 * them through package.json `exports` — no tsconfig `paths` — so it sees
 * exactly what an npm consumer sees. A socket this file cannot use without
 * private access is not a socket.
 *
 * Phase 0: type-level coverage of the extension surface that has shipped.
 * Each later phase of wiki [[Extension Sockets — Implementation Plan]] adds
 * its socket here (and runtime checks once a headless harness exists).
 */
import { ManifestSession, urlToManifest } from '@lazstream/core'
import type { DecodedChunk, FieldDemand, LasField } from '@lazstream/core'
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
