/**
 * LAS field masks — which per-point fields a consumer wants fetched/decoded.
 *
 * Public API uses LAS spec field names (`LasField`). Internally a mask is a
 * 13-bit number, one bit per field in `LAS_FIELDS` order. The order is part of
 * the IDB cache key for compact (layer-selective) chunks — if it ever changes,
 * bump COMPACT_CACHE_VARIANT_PREFIX in streaming-engine.ts.
 *
 * `xyz` is forced into every effective mask: positions are the one field the
 * pipeline can never skip.
 */

export type LasField =
  | 'xyz' | 'intensity' | 'returns' | 'flags' | 'classification'
  | 'scanAngle' | 'userData' | 'pointSourceId' | 'gpsTime'
  | 'rgb' | 'nir' | 'wavepacket' | 'extraBytes'

/** Bit order. Keep in sync with FIELD_BIT in workers/point-fields.ts. */
export const LAS_FIELDS: readonly LasField[] = [
  'xyz', 'intensity', 'returns', 'flags', 'classification',
  'scanAngle', 'userData', 'pointSourceId', 'gpsTime',
  'rgb', 'nir', 'wavepacket', 'extraBytes',
]

const BIT = new Map<LasField, number>(LAS_FIELDS.map((f, i) => [f, 1 << i]))

export const FIELD_BITS_ALL = (1 << LAS_FIELDS.length) - 1
export const XYZ_BIT = 1

/** Fields that surface as ChunkAttributes arrays. xyz / classification / rgb
 *  already have native DecodedChunk slots; wavepacket is never surfaced. */
export const SURFACEABLE_BITS =
  (1 << 1) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 10) | (1 << 12)

export function fieldBit(field: LasField): number {
  const b = BIT.get(field)
  if (b === undefined) throw new Error(`Unknown LAS field: ${String(field)}`)
  return b
}

export function toBits(fields: Iterable<LasField>): number {
  let bits = 0
  for (const f of fields) bits |= fieldBit(f)
  return bits
}

export function fromBits(bits: number): Set<LasField> {
  const out = new Set<LasField>()
  for (let i = 0; i < LAS_FIELDS.length; i++) {
    if (bits & (1 << i)) out.add(LAS_FIELDS[i])
  }
  return out
}

export function hasField(bits: number, field: LasField): boolean {
  return (bits & fieldBit(field)) !== 0
}

/** True if every bit of `sub` is set in `sup`. */
export function isSubsetBits(sub: number, sup: number): boolean {
  return (sub & ~sup) === 0
}

export function popcount(bits: number): number {
  let n = 0
  while (bits) { bits &= bits - 1; n++ }
  return n
}

/** Everything the PDRF carries — equivalent to today's full-chunk behaviour. */
export const FIELDS_ALL: ReadonlySet<LasField> = new Set(LAS_FIELDS)

/** What the stock renderer reads: positions, intensity, classification, RGB,
 *  plus returns+flags (free — they share the always-fetched xy layer and the
 *  flags layer sits inside the same contiguous byte run as layers 0–4). */
export const FIELDS_RENDER: ReadonlySet<LasField> = new Set<LasField>([
  'xyz', 'intensity', 'returns', 'flags', 'classification', 'rgb',
])

/** Core record length (no extra bytes) per PDRF. */
const BASE_RECORD_LENGTH: Record<number, number> = {
  0: 20, 1: 28, 2: 26, 3: 34, 4: 57, 5: 63,
  6: 30, 7: 36, 8: 38, 9: 59, 10: 67,
}

/** Bits of the fields physically present in a point format. */
export function fieldBitsInFormat(pdrf: number, recordLength: number): number {
  let bits = toBits(['xyz', 'intensity', 'returns', 'flags', 'classification',
    'scanAngle', 'userData', 'pointSourceId'])
  if (pdrf === 1 || pdrf >= 3) bits |= fieldBit('gpsTime')
  if (pdrf === 2 || pdrf === 3 || pdrf === 5 || pdrf === 7 || pdrf === 8 || pdrf === 10) bits |= fieldBit('rgb')
  if (pdrf === 8 || pdrf === 10) bits |= fieldBit('nir')
  if (pdrf === 4 || pdrf === 5 || pdrf === 9 || pdrf === 10) bits |= fieldBit('wavepacket')
  const base = BASE_RECORD_LENGTH[pdrf]
  if (base !== undefined && recordLength > base) bits |= fieldBit('extraBytes')
  return bits
}

/** Fields physically present in a point format (gpsTime absent in PDRF 0/2 etc.). */
export function fieldsInFormat(pdrf: number, recordLength: number): ReadonlySet<LasField> {
  return fromBits(fieldBitsInFormat(pdrf, recordLength))
}

/** Normalise the public `fetchFields` option to bits (xyz forced). */
export function resolveFetchFields(option: 'all' | 'render' | Iterable<LasField> | undefined): number {
  if (option === undefined || option === 'all') return FIELD_BITS_ALL
  if (option === 'render') return toBits(FIELDS_RENDER)
  return toBits(option) | XYZ_BIT
}

// ─── Demands ────────────────────────────────────────────────────────────────

/** Handle returned by demandFields(). Anonymous and ref-counted — core never
 *  learns who asked. `release()` is idempotent. */
export interface FieldDemand {
  readonly fields: ReadonlySet<LasField>
  release(): void
}

/**
 * Ref-counted union of field demands on top of a base mask. Shared by
 * StreamingEngine (per tile) and ManifestSession (session-wide view).
 * `onChange` fires only when the fetch or surface bits actually change.
 */
export class FieldDemandSet {
  private demands = new Set<{ bits: number; surface: boolean }>()
  private lastFetch: number
  private lastSurface: number

  constructor(
    private readonly baseBits: number,
    private readonly onChange?: (fetchBits: number, surfaceBits: number) => void,
  ) {
    this.lastFetch = this.fetchBits()
    this.lastSurface = this.surfaceBits()
  }

  /** base ∪ (∪ live demands) ∪ {xyz} */
  fetchBits(): number {
    let bits = this.baseBits | XYZ_BIT
    for (const d of this.demands) bits |= d.bits
    return bits
  }

  /** (∪ surfacing demands) ∩ fetch bits. Callers further mask by format. */
  surfaceBits(): number {
    let bits = 0
    for (const d of this.demands) if (d.surface) bits |= d.bits
    return bits & this.fetchBits()
  }

  add(fields: Iterable<LasField>, surface: boolean): FieldDemand {
    const fieldSet: ReadonlySet<LasField> = new Set(fields)
    const entry = { bits: toBits(fieldSet), surface }
    this.demands.add(entry)
    this.notify()
    let released = false
    return {
      fields: fieldSet,
      release: () => {
        if (released) return
        released = true
        this.demands.delete(entry)
        this.notify()
      },
    }
  }

  private notify(): void {
    const f = this.fetchBits()
    const s = this.surfaceBits()
    if (f === this.lastFetch && s === this.lastSurface) return
    this.lastFetch = f
    this.lastSurface = s
    this.onChange?.(f, s)
  }
}
