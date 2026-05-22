/**
 * Manifest loader — fetches and validates .lazm.json manifests.
 *
 * Three public functions:
 *   fetchManifest(url)   — fetch + parse a remote .lazm.json
 *   parseManifest(raw)   — validate a raw JSON value (already fetched)
 *   urlToManifest(url)   — wrap a bare .laz URL in a synthetic one-tile manifest
 *
 * URL security (scheme whitelist, private IP block) is NOT done here — it is
 * enforced by validateSourceUrl / validateManifestUrl in url-validator.ts and
 * by StreamingEngine.load() on each tile URL. This keeps the parser pure and
 * testable without DOM/network dependencies.
 */

import type { Manifest, TileEntry } from './manifest-types.js'
import { NetworkError } from '../network/range-fetcher.js'

// ─── Error ───────────────────────────────────────────────────────────────────

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestParseError'
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a .lazm.json manifest from a URL and return the parsed result.
 * Throws NetworkError on HTTP failure, ManifestParseError on invalid JSON/schema.
 *
 * Uses cache: 'no-store' — required by COOP/COEP headers active on the server
 * (same requirement as all other fetch calls in the engine).
 */
export async function fetchManifest(
  url: string,
  signal?: AbortSignal,
): Promise<Manifest> {
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new NetworkError(`Manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!res.ok) {
    throw new NetworkError(`Manifest fetch failed: ${res.status} ${res.statusText} (${url})`)
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new ManifestParseError(`Manifest is not valid JSON (${url})`)
  }

  return parseManifest(raw)
}

/**
 * Parse and validate a manifest from a raw JSON value.
 * Throws ManifestParseError with a human-readable message on any schema violation.
 */
export function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestParseError('Manifest must be a JSON object')
  }

  const obj = raw as Record<string, unknown>

  // version — must be exactly "1.0"
  if (obj['version'] !== '1.0') {
    throw new ManifestParseError(
      `Unsupported manifest version "${obj['version']}". ` +
      `This viewer supports version "1.0" only.`
    )
  }

  // tiles — non-empty array
  if (!Array.isArray(obj['tiles']) || obj['tiles'].length === 0) {
    throw new ManifestParseError('Manifest "tiles" must be a non-empty array')
  }

  const tiles: TileEntry[] = obj['tiles'].map((entry: unknown, i: number) => {
    return parseTileEntry(entry, i)
  })

  // Optional string fields
  const name       = optionalString(obj, 'name')
  const attribution = optionalString(obj, 'attribution')
  const srs        = optionalString(obj, 'srs')

  return { version: '1.0', tiles, name, attribution, srs }
}

/**
 * Wrap a single .laz URL in a synthetic one-tile manifest.
 * Single-file loading uses this so there is one code path for all loads.
 */
export function urlToManifest(lazUrl: string): Manifest {
  return { version: '1.0', tiles: [{ url: lazUrl }] }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseTileEntry(raw: unknown, index: number): TileEntry {
  const prefix = `Manifest tile[${index}]`

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestParseError(`${prefix} must be an object`)
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj['url'] !== 'string' || obj['url'].trim() === '') {
    throw new ManifestParseError(`${prefix} must have a non-empty "url" string`)
  }

  const entry: TileEntry = { url: obj['url'].trim() }

  // Optional bounds
  if ('bounds' in obj && obj['bounds'] !== undefined) {
    const b = obj['bounds'] as Record<string, unknown>
    if (typeof b !== 'object' || b === null) {
      throw new ManifestParseError(`${prefix} "bounds" must be an object`)
    }
    entry.bounds = {
      min: parseXYZArray(b['min'], `${prefix} bounds.min`),
      max: parseXYZArray(b['max'], `${prefix} bounds.max`),
    }
  }

  // Optional points
  if ('points' in obj && obj['points'] !== undefined) {
    const p = obj['points']
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) {
      throw new ManifestParseError(`${prefix} "points" must be a positive finite number`)
    }
    entry.points = p
  }

  // Optional srs
  const srs = optionalString(obj, 'srs')
  if (srs !== undefined) entry.srs = srs

  return entry
}

function parseXYZArray(raw: unknown, label: string): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new ManifestParseError(`${label} must be an array of 3 finite numbers`)
  }
  return [raw[0] as number, raw[1] as number, raw[2] as number]
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ManifestParseError(`Manifest "${key}" must be a non-empty string if present`)
  }
  return v.trim()
}
