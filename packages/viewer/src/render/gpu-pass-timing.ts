/**
 * GpuPassTiming — per-pass GPU timestamp instrumentation.
 *
 * Stage 0 of the Renderer Performance Roadmap ([[Renderer Performance
 * Roadmap]] wiki page). Times the three passes (clear-depth, points-depth,
 * resolve) each instrumented frame via `timestampWrites` on the pass
 * descriptors, resolves the query set into a buffer, and copies it to one
 * of a small pool of MAP_READ staging buffers for async readback.
 *
 * Readback discipline: never stalls the frame loop. If every staging buffer
 * is still in flight when a frame starts, that frame simply isn't
 * instrumented. Construction is gated behind ?gputiming=1 AND the device
 * having the 'timestamp-query' feature — when disabled, none of this exists
 * and the render loop pays nothing.
 *
 * Output: one console line per second with rolling avg/max per pass
 * (~60-frame window) plus the visible slot count and visible point total of
 * the most recent instrumented frame. Timestamps arrive in nanoseconds;
 * logged in ms.
 */

import { BYTES_PER_POINT } from './point-packing'

/** Pass order must match the renderer's timestampWrites indices. */
const PASS_NAMES = ['clear', 'depth', 'resolve'] as const
const PASS_COUNT = PASS_NAMES.length
const QUERY_COUNT = PASS_COUNT * 2          // begin + end per pass
const RESOLVE_BYTES = QUERY_COUNT * 8       // u64 per timestamp
const STAGING_POOL_SIZE = 3
const WINDOW_FRAMES = 60
const LOG_INTERVAL_MS = 1000

interface StagingEntry {
  buffer: GPUBuffer
  inFlight: boolean
  /** Visible-slot / visible-point snapshot of the frame this readback belongs to. */
  slots: number
  points: number
}

// GPUComputePassTimestampWrites and GPURenderPassTimestampWrites are
// structurally identical; the intersection satisfies both descriptors.
type PassTimestampWrites = GPUComputePassTimestampWrites & GPURenderPassTimestampWrites

export class GpuPassTiming {
  private readonly querySet: GPUQuerySet
  private readonly resolveBuffer: GPUBuffer
  private readonly staging: StagingEntry[]
  private current: StagingEntry | null = null
  private disposed = false

  // Rolling window per pass (circular), plus a per-frame total series at
  // index PASS_COUNT — max(total) must come from single frames, not the sum
  // of per-pass maxima (which may land on different frames). samples[series][i] in ms.
  private readonly samples: Float64Array[] =
    Array.from({ length: PASS_COUNT + 1 }, () => new Float64Array(WINDOW_FRAMES))
  private sampleCount = 0   // total recorded (write index = sampleCount % WINDOW)
  private lastLogAt = 0
  private lastSlots = 0
  private lastPoints = 0

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({
      label: 'lazstream/gputiming-queries',
      type: 'timestamp',
      count: QUERY_COUNT,
    })
    this.resolveBuffer = device.createBuffer({
      label: 'lazstream/gputiming-resolve',
      size: RESOLVE_BYTES,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    })
    this.staging = Array.from({ length: STAGING_POOL_SIZE }, (_, i) => ({
      buffer: device.createBuffer({
        label: `lazstream/gputiming-staging-${i}`,
        size: RESOLVE_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      inFlight: false,
      slots: 0,
      points: 0,
    }))

    // Stride audit (roadmap Stage 0): re-anchors the bandwidth arithmetic.
    console.log(
      `[gputiming] enabled — packed stride ${BYTES_PER_POINT} B/point ` +
      `(${BYTES_PER_POINT / 4} × u32); window ${WINDOW_FRAMES} frames, ` +
      `staging pool ${STAGING_POOL_SIZE}`
    )
  }

  /**
   * Claim a staging buffer for this frame. Returns false (frame not
   * instrumented) when the whole pool is awaiting readback.
   */
  tryBeginFrame(): boolean {
    if (this.disposed) return false
    this.current = this.staging.find(s => !s.inFlight) ?? null
    return this.current !== null
  }

  /** timestampWrites descriptor for pass `passIdx` (0=clear 1=depth 2=resolve). */
  timestampWrites(passIdx: number): PassTimestampWrites {
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: passIdx * 2,
      endOfPassWriteIndex:       passIdx * 2 + 1,
    }
  }

  /**
   * Encode resolve + copy-to-staging. Must be called after the last timed
   * pass ended and before the encoder is finished/submitted.
   */
  encodeResolve(encoder: GPUCommandEncoder, visibleSlots: number, visiblePoints: number): void {
    const s = this.current
    if (!s) return
    encoder.resolveQuerySet(this.querySet, 0, QUERY_COUNT, this.resolveBuffer, 0)
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, s.buffer, 0, RESOLVE_BYTES)
    s.inFlight = true
    s.slots = visibleSlots
    s.points = visiblePoints
  }

  /** Kick the async readback for the frame just submitted. Never awaited by the caller. */
  readbackAfterSubmit(): void {
    const s = this.current
    this.current = null
    if (!s || !s.inFlight) return
    s.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (this.disposed) return
      const ts = new BigUint64Array(s.buffer.getMappedRange().slice(0))
      s.buffer.unmap()
      s.inFlight = false
      this.record(ts, s.slots, s.points)
    }).catch(() => {
      // Device lost / disposed mid-map — just return the buffer to the pool.
      s.inFlight = false
    })
  }

  private record(ts: BigUint64Array, slots: number, points: number): void {
    const idx = this.sampleCount % WINDOW_FRAMES
    let frameTotal = 0
    for (let p = 0; p < PASS_COUNT; p++) {
      // Some drivers can report begin/end out of order on empty passes; clamp.
      const ns = Number(ts[p * 2 + 1]! - ts[p * 2]!)
      const ms = ns > 0 && Number.isFinite(ns) ? ns / 1e6 : 0
      this.samples[p]![idx] = ms
      frameTotal += ms
    }
    this.samples[PASS_COUNT]![idx] = frameTotal
    this.sampleCount++
    this.lastSlots = slots
    this.lastPoints = points
    this.maybeLog()
  }

  private maybeLog(): void {
    const now = performance.now()
    if (now - this.lastLogAt < LOG_INTERVAL_MS) return
    this.lastLogAt = now

    const n = Math.min(this.sampleCount, WINDOW_FRAMES)
    if (n === 0) return

    const parts: string[] = []
    let totalPart = ''
    for (let p = 0; p <= PASS_COUNT; p++) {
      let sum = 0
      let max = 0
      for (let i = 0; i < n; i++) {
        const v = this.samples[p]![i]!
        sum += v
        if (v > max) max = v
      }
      const avg = sum / n
      if (p < PASS_COUNT) parts.push(`${PASS_NAMES[p]} ${avg.toFixed(2)}/${max.toFixed(2)}`)
      else totalPart = `${avg.toFixed(2)}/${max.toFixed(2)}`
    }

    console.log(
      `[gputiming] ${parts.join('  ')}  total ${totalPart} ms ` +
      `(avg/max over ${n} frames) — ${this.lastSlots} slots, ` +
      `${(this.lastPoints / 1e6).toFixed(2)}M pts, ${BYTES_PER_POINT} B/pt`
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.querySet.destroy()
    this.resolveBuffer.destroy()
    for (const s of this.staging) s.buffer.destroy()
  }
}
