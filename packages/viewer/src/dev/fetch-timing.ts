type DecodeEvent = { chunkIndex: number; decodeMs: number }
type EntryKind = 'probe' | 'seed' | 'chunk' | 'decode'

// ═════════════════════════════════════════════════════════════════════════════
// Camera-move metrics — chunk priority ordering spike
//
// Two metrics over one camera move (see wiki spike-chunk-priority-ordering):
//   1. Wasted-fetch ratio — chunks decoded during the move that end up
//      outside the settled viewport, / total decoded during the move.
//   2. Time-to-90%-of-final-visible-points-resident — wall-clock from
//      move start until 90% of the points on-screen in the settled view
//      were decoded and resident.
//
// The recorder is renderer-agnostic: visibility against the settled frustum
// is injected as a predicate at finalize() time (camera-bench.ts supplies
// WebGPURenderer.isWorldBBoxVisible). Move-start / settled events come from
// the bench's velocity-based settle detector.
// ═════════════════════════════════════════════════════════════════════════════

export interface MoveBBox {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}

interface MoveDecodeRecord {
  chunkIndex: number
  pointCount: number
  bbox: MoveBBox
  /** performance.now() when the decode landed. */
  t: number
}

interface WastedFetchWindow {
  decodedChunks: number
  wastedChunks: number
  chunkRatio: number
  decodedPoints: number
  wastedPoints: number
  pointsRatio: number
}

export interface MoveMetrics {
  moveDurationMs: number
  /** Decodes landing in (moveStart, settled]. */
  wastedFetchMove: WastedFetchWindow
  /** Decodes landing in (moveStart, drain] — includes in-flight stragglers. */
  wastedFetchToDrain: WastedFetchWindow
  /** ms from move start until 90% of final visible points were resident.
   *  0 when the baseline already covered 90%; null when nothing is visible. */
  t90Ms: number | null
  finalVisibleChunks: number
  finalVisiblePoints: number
  /** Fraction of final visible points already resident at move start. */
  baselineVisibleFraction: number
  residentChunks: number
  evictions: number
  /** [secondsSinceMoveStart, cumulativeVisiblePointsResident] per second.
   *  Absolute fill progress — comparable across runs even when the final
   *  visible sets differ. Entry at 0 is the pre-move baseline. */
  visibleResidencyCurve: Array<[number, number]>
}

export class MoveMetricsRecorder {
  /** Every decode since recording began, in arrival order. Never pruned. */
  private readonly allDecodes: MoveDecodeRecord[] = []
  /** Chunks currently resident (decoded and not evicted). */
  private readonly resident = new Map<number, MoveDecodeRecord>()
  private evictions = 0
  private tMoveStart: number | null = null
  private tSettled: number | null = null
  private tLastDecode = 0

  recordDecode(chunkIndex: number, pointCount: number, bbox: MoveBBox): void {
    const rec: MoveDecodeRecord = { chunkIndex, pointCount, bbox, t: performance.now() }
    this.allDecodes.push(rec)
    this.resident.set(chunkIndex, rec)
    this.tLastDecode = rec.t
  }

  recordEviction(chunkIndex: number): void {
    if (this.resident.delete(chunkIndex)) this.evictions++
  }

  markMoveStart(): void {
    this.tMoveStart = performance.now()
  }

  markSettled(t?: number): void {
    this.tSettled = t ?? performance.now()
  }

  /** performance.now() of the most recent decode — drain detection. */
  get lastDecodeAt(): number {
    return this.tLastDecode
  }

  get settled(): boolean {
    return this.tSettled !== null
  }

  /**
   * Compute both metrics. Call once the camera has settled AND the decode
   * stream has drained, with the camera unchanged since settle (the
   * visibility predicate is evaluated against the current frustum).
   */
  finalize(isVisible: (bbox: MoveBBox) => boolean): MoveMetrics {
    const tStart = this.tMoveStart ?? 0
    const tSettled = this.tSettled ?? performance.now()

    const windowStats = (records: MoveDecodeRecord[]): WastedFetchWindow => {
      let wastedChunks = 0
      let decodedPoints = 0
      let wastedPoints = 0
      for (const r of records) {
        decodedPoints += r.pointCount
        if (!isVisible(r.bbox)) {
          wastedChunks++
          wastedPoints += r.pointCount
        }
      }
      return {
        decodedChunks: records.length,
        wastedChunks,
        chunkRatio: records.length > 0 ? wastedChunks / records.length : 0,
        decodedPoints,
        wastedPoints,
        pointsRatio: decodedPoints > 0 ? wastedPoints / decodedPoints : 0,
      }
    }

    const duringMove = this.allDecodes.filter(r => r.t > tStart && r.t <= tSettled)
    const toDrain    = this.allDecodes.filter(r => r.t > tStart)

    // Final visible set: resident chunks whose bbox intersects the settled
    // frustum. Each carries its decode timestamp (may pre-date the move).
    const visible: MoveDecodeRecord[] = []
    let finalVisiblePoints = 0
    for (const r of this.resident.values()) {
      if (isVisible(r.bbox)) {
        visible.push(r)
        finalVisiblePoints += r.pointCount
      }
    }

    let t90Ms: number | null = null
    let baselinePoints = 0
    const curve: Array<[number, number]> = []
    if (finalVisiblePoints > 0) {
      visible.sort((a, b) => a.t - b.t)
      const target = 0.9 * finalVisiblePoints
      let cum = 0
      let second = 0
      for (const r of visible) {
        if (r.t <= tStart) baselinePoints += r.pointCount
        // Close out whole seconds before this record lands.
        const recSecond = Math.max(0, Math.ceil((r.t - tStart) / 1000))
        while (second < recSecond) curve.push([second++, cum])
        cum += r.pointCount
        if (t90Ms === null && cum >= target) {
          t90Ms = Math.max(0, r.t - tStart)
        }
      }
      curve.push([second, cum])
    }

    return {
      moveDurationMs: Math.max(0, tSettled - tStart),
      wastedFetchMove: windowStats(duringMove),
      wastedFetchToDrain: windowStats(toDrain),
      t90Ms,
      finalVisibleChunks: visible.length,
      finalVisiblePoints,
      baselineVisibleFraction:
        finalVisiblePoints > 0 ? baselinePoints / finalVisiblePoints : 0,
      residentChunks: this.resident.size,
      evictions: this.evictions,
      visibleResidencyCurve: curve,
    }
  }
}

interface Row {
  timestamp_ms: number
  kind: EntryKind
  url_path: string
  ttfb_ms: number
  body_ms: number
  total_ms: number
  transfer_size: number
  chunk_index: string
  decode_ms: string
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function kindFromSize(size: number): 'probe' | 'seed' | 'chunk' {
  if (size > 10_000) return 'chunk'
  if (size > 100)   return 'seed'
  return 'probe'
}

export function installFetchTimingObserver(opts: {
  origin: string
  onChunkDecoded: (cb: (chunk: DecodeEvent) => void) => void
  logEveryN?: number
  label?: string
}): { dispose: () => void } {
  const N     = opts.logEveryN ?? 25
  const label = opts.label ?? 'lazstream/diagnostic'

  const allRows: Row[] = []

  // Rolling windows — reset after each log line
  const wTtfb:  number[] = []
  const wBody:  number[] = []
  const wTotal: number[] = []
  const wDec:   number[] = []

  function flushFetchWindow() {
    const sTtfb  = [...wTtfb].sort((a, b) => a - b)
    const sBody  = [...wBody].sort((a, b) => a - b)
    const sTotal = [...wTotal].sort((a, b) => a - b)
    const fracs  = sTotal.map((t, i) => sBody[i] / (t || 1)).sort((a, b) => a - b)
    console.log(
      `[${label}] last ${wTtfb.length} fetches` +
      ` · TTFB p50 ${pct(sTtfb, 0.5)}ms p95 ${pct(sTtfb, 0.95)}ms` +
      ` · body p50 ${pct(sBody, 0.5)}ms p95 ${pct(sBody, 0.95)}ms` +
      ` · body frac p50 ${pct(fracs, 0.5).toFixed(2)}`
    )
    wTtfb.length = 0; wBody.length = 0; wTotal.length = 0
  }

  function flushDecodeWindow() {
    const s = [...wDec].sort((a, b) => a - b)
    console.log(
      `[${label}] last ${wDec.length} decodes` +
      ` · decode p50 ${pct(s, 0.5)}ms p95 ${pct(s, 0.95)}ms`
    )
    wDec.length = 0
  }

  // PerformanceObserver — receives resource entries as they complete
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      if (!e.name.startsWith(opts.origin)) continue

      const ttfb_ms     = Math.round(e.responseStart - e.startTime)
      const body_ms     = Math.round(e.responseEnd   - e.responseStart)
      const total_ms    = Math.round(e.responseEnd   - e.startTime)
      const transfer    = e.transferSize
      const kind        = kindFromSize(transfer)
      const url         = new URL(e.name)

      allRows.push({
        timestamp_ms: e.startTime, kind,
        url_path: url.pathname + url.search,
        ttfb_ms, body_ms, total_ms,
        transfer_size: transfer,
        chunk_index: '', decode_ms: '',
      })

      if (kind === 'chunk') {
        wTtfb.push(ttfb_ms); wBody.push(body_ms); wTotal.push(total_ms)
        if (wTtfb.length >= N) flushFetchWindow()
      }
    }
  })
  observer.observe({ type: 'resource', buffered: true })

  // Decode-event listener
  opts.onChunkDecoded((chunk) => {
    allRows.push({
      timestamp_ms: performance.now(), kind: 'decode',
      url_path: '', ttfb_ms: 0, body_ms: 0, total_ms: 0, transfer_size: 0,
      chunk_index: String(chunk.chunkIndex),
      decode_ms:   String(chunk.decodeMs),
    })
    wDec.push(chunk.decodeMs)
    if (wDec.length >= N) flushDecodeWindow()
  })

  // Session summary — call via window.__lazstreamSessionSummary()
  function sessionSummary() {
    const chunks  = allRows.filter(r => r.kind === 'chunk')
    const decodes = allRows.filter(r => r.kind === 'decode')
    const sTtfb   = chunks.map(r => r.ttfb_ms).sort((a, b) => a - b)
    const sBody   = chunks.map(r => r.body_ms).sort((a, b) => a - b)
    const fracs   = chunks.map(r => r.body_ms / (r.total_ms || 1)).sort((a, b) => a - b)
    const sDec    = decodes.map(r => Number(r.decode_ms)).sort((a, b) => a - b)
    console.log(
      `[${label}] session summary` +
      ` · fetches=${chunks.length} decodes=${decodes.length}` +
      ` · TTFB p50 ${pct(sTtfb, 0.5)} p95 ${pct(sTtfb, 0.95)}` +
      ` · body p50 ${pct(sBody, 0.5)} p95 ${pct(sBody, 0.95)}` +
      ` · decode p50 ${pct(sDec, 0.5)} p95 ${pct(sDec, 0.95)}` +
      ` · body fraction p50 ${pct(fracs, 0.5).toFixed(2)}`
    )
  }

  // CSV dump — call via window.__lazstreamDumpTimings()
  function dumpTimings(): string {
    const header = 'timestamp_ms,kind,url_path,ttfb_ms,body_ms,total_ms,transfer_size,chunk_index,decode_ms'
    const rows = allRows.map(r =>
      [
        r.timestamp_ms.toFixed(2), r.kind, r.url_path,
        r.ttfb_ms, r.body_ms, r.total_ms, r.transfer_size,
        r.chunk_index, r.decode_ms,
      ].join(',')
    )
    return [header, ...rows].join('\n')
  }

  ;(window as any).__lazstreamDumpTimings    = dumpTimings
  ;(window as any).__lazstreamSessionSummary = sessionSummary

  return {
    dispose() {
      observer.disconnect()
      delete (window as any).__lazstreamDumpTimings
      delete (window as any).__lazstreamSessionSummary
    },
  }
}
