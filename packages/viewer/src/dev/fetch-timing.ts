type DecodeEvent = { chunkIndex: number; decodeMs: number }
type EntryKind = 'probe' | 'seed' | 'chunk' | 'decode'

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
