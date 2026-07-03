/**
 * Camera-path benchmark — chunk priority ordering spike.
 *
 * Drives the camera along a scripted, reproducible path (?bench=pan|jump)
 * and records the two spike metrics via MoveMetricsRecorder. Runs are
 * comparable across ?order= values because the paths are pure functions of
 * the file's header bbox — no manual mouse input.
 *
 * Paths (fractions of header bbox; cx/cy = bbox centre, rx/ry = XY ranges,
 * d = max(rx, ry), groundZ = header.minZ — exact values recorded in the
 * wiki spike page):
 *
 *   pan  — 12 s linear, constant velocity, fixed altitude:
 *          eye    (cx − 0.30·rx → cx + 0.30·rx, cy − 0.25·ry, groundZ + 0.12·d)
 *          target (eyeX,                        cy + 0.10·ry, groundZ)
 *
 *   jump — hold the fitCameraToHeader overview, then instantly reposition:
 *          eye    (cx + 0.10·rx, cy + 0.10·ry − 0.02·d, groundZ + 0.01·d)
 *          target (cx + 0.10·rx, cy + 0.10·ry,          groundZ)
 *
 * "Settled" (defined locally for this spike — the parked velocity-aware
 * priority work will need the same signal; duplication flagged in the wiki):
 * camera speed below 1e-4·d units/second for 45 consecutive frames. The
 * settle timestamp is the first frame of that quiet streak.
 *
 * Lifecycle: install → seeds ready → hold (default 8 s, lets overview
 * streaming reach a steady state) → move → settle → drain (no decodes for
 * 5 s, 120 s timeout) → finalize. Result goes to console as
 * `[bench] RESULT {json}`, to window.__lazstreamBenchResult, and into
 * document.title (`BENCH-DONE ...`) so a CDP driver can poll for it.
 */

import type { DecodedChunk, LasHeader, CameraState } from '@lazstream/core'
import type { WebGPURenderer } from '../render/webgpu-renderer.js'
import { MoveMetricsRecorder } from './fetch-timing.js'

export type BenchPath = 'pan' | 'jump'

export interface CameraBench {
  notifySeedsReady(header: LasHeader): void
  notifyChunkDecoded(chunk: DecodedChunk): void
  notifyChunkEvicted(chunkIndex: number): void
}

const PRE_MOVE_HOLD_MS  = 8_000
const PAN_DURATION_MS   = 12_000
const SETTLE_FRAMES     = 45
/** Speed threshold as a fraction of d (max horizontal extent), per second. */
const SETTLE_SPEED_FRACTION = 1e-4
const DRAIN_QUIET_MS    = 5_000
/**
 * Fixed measurement horizon after settle. The engine currently never
 * drains at ground-level views — the loose engine-side frustum AABB admits
 * chunks the renderer's exact-plane cull rejects, producing a perpetual
 * decode→evict→re-queue churn loop (measured ~12 chunks/s on Melbourne;
 * see wiki spike page). A fixed horizon keeps runs comparable: every run
 * reports the state at exactly settle + HORIZON_MS unless it genuinely
 * drained first.
 */
const HORIZON_MS        = 60_000
const DRAIN_TIMEOUT_MS  = 120_000

export function installCameraBench(opts: {
  renderer: WebGPURenderer
  path: BenchPath
  /** ?order= value, recorded in the result for run labelling. */
  order: string
  holdMs?: number
}): CameraBench {
  const { renderer, path, order } = opts
  const holdMs = opts.holdMs ?? PRE_MOVE_HOLD_MS
  const recorder = new MoveMetricsRecorder()

  let started = false
  let finished = false

  function run(header: LasHeader): void {
    const cx = (header.minX + header.maxX) / 2
    const cy = (header.minY + header.maxY) / 2
    const rx = header.maxX - header.minX
    const ry = header.maxY - header.minY
    const d  = Math.max(rx, ry)
    const groundZ = header.minZ
    const fovY = renderer.getFovY()

    const state = (
      ex: number, ey: number, ez: number,
      tx: number, ty: number, tz: number,
    ): CameraState => ({ x: ex, y: ey, z: ez, tx, ty, tz, fovY })

    // ── Settle detector — velocity-based, sampled every rAF ────────────────
    const speedThreshold = SETTLE_SPEED_FRACTION * d // units per second
    let prevPos: { x: number; y: number; z: number } | null = null
    let prevT = 0
    let quietStreak = 0
    let quietSince = 0

    function sampleVelocity(now: number): void {
      const pos = renderer.getCameraWorldPosition()
      if (prevPos !== null) {
        const dt = (now - prevT) / 1000
        if (dt > 0) {
          const dist = Math.hypot(pos.x - prevPos.x, pos.y - prevPos.y, pos.z - prevPos.z)
          if (dist / dt < speedThreshold) {
            if (quietStreak === 0) quietSince = now
            quietStreak++
            if (quietStreak === SETTLE_FRAMES && !recorder.settled) {
              recorder.markSettled(quietSince)
              settledAtWallClock = now
              console.log(`[bench] settled at +${(quietSince - moveStartT).toFixed(0)} ms`)
            }
          } else {
            quietStreak = 0
          }
        }
      }
      prevPos = pos
      prevT = now
    }

    // ── Movement drivers ───────────────────────────────────────────────────
    let moveStartT = 0
    /** Wall clock when the settle detector fired — anchors HORIZON_MS. */
    let settledAtWallClock = 0

    function startPan(): void {
      const eyeY = cy - 0.25 * ry
      const eyeZ = groundZ + 0.12 * d
      const x0 = cx - 0.30 * rx
      const x1 = cx + 0.30 * rx

      recorder.markMoveStart()
      moveStartT = performance.now()

      const frame = (): void => {
        const now = performance.now()
        const p = Math.min(1, (now - moveStartT) / PAN_DURATION_MS)
        const ex = x0 + (x1 - x0) * p
        renderer.applyCameraState(state(ex, eyeY, eyeZ, ex, cy + 0.10 * ry, groundZ))
        sampleVelocity(now)
        if (!recorder.settled && !finished) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }

    function startJump(): void {
      recorder.markMoveStart()
      moveStartT = performance.now()
      renderer.applyCameraState(state(
        cx + 0.10 * rx, cy + 0.10 * ry - 0.02 * d, groundZ + 0.01 * d,
        cx + 0.10 * rx, cy + 0.10 * ry,            groundZ,
      ))
      const frame = (): void => {
        sampleVelocity(performance.now())
        if (!recorder.settled && !finished) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }

    // ── Drain + finalize ───────────────────────────────────────────────────
    const settleWaitT0 = performance.now()
    const drainPoll = setInterval(() => {
      if (finished) { clearInterval(drainPoll); return }
      if (!recorder.settled) {
        // Path drivers stop themselves on settle; guard against a detector
        // that never fires (shouldn't happen with scripted paths).
        if (performance.now() - settleWaitT0 > DRAIN_TIMEOUT_MS) finalize('settle-timeout')
        return
      }
      const now = performance.now()
      const quietFor = now - Math.max(recorder.lastDecodeAt, moveStartT)
      if (quietFor > DRAIN_QUIET_MS) finalize('drained')
      else if (settledAtWallClock !== 0 && now - settledAtWallClock > HORIZON_MS) finalize('horizon')
      else if (now - moveStartT > DRAIN_TIMEOUT_MS) finalize('drain-timeout')
    }, 500)

    function finalize(reason: string): void {
      if (finished) return
      finished = true
      clearInterval(drainPoll)

      const metrics = recorder.finalize(bbox => renderer.isWorldBBoxVisible(bbox))
      const exactCull = new URLSearchParams(location.search).get('exactCull') !== '0'
      const result = { bench: path, order, exactCull, reason, ...metrics }
      console.log('[bench] RESULT ' + JSON.stringify(result))
      ;(window as unknown as Record<string, unknown>).__lazstreamBenchResult = result
      document.title = `BENCH-DONE ${path}/${order}`

      // ?benchPost=<port>: fire-and-forget the result to a localhost
      // collector, for automated runs where the console isn't reachable.
      // text/plain keeps it a simple CORS request (no preflight); the
      // opaque response is irrelevant.
      const postPort = new URLSearchParams(location.search).get('benchPost')
      if (postPort && /^\d+$/.test(postPort)) {
        void fetch(`http://localhost:${postPort}/bench-result`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify(result),
          keepalive: true,
        }).catch(() => { /* collector gone — console output still has it */ })
      }
    }

    // ── Kick off after the hold ────────────────────────────────────────────
    // Pan holds AT the pan-start pose so the move is a pure pan; without
    // this the hold happens at the overview and the "pan" begins with a
    // hidden overview→pan-start teleport that contaminates the metrics.
    // Jump holds at the fitCameraToHeader overview by design.
    if (path === 'pan') {
      const ex = cx - 0.30 * rx
      renderer.applyCameraState(state(
        ex, cy - 0.25 * ry, groundZ + 0.12 * d,
        ex, cy + 0.10 * ry, groundZ,
      ))
    }
    console.log(
      `[bench] armed: path=${path} order=${order} — moving in ${holdMs} ms ` +
      `(bbox ${rx.toFixed(0)}×${ry.toFixed(0)}, d=${d.toFixed(0)})`
    )
    setTimeout(() => {
      if (path === 'pan') startPan()
      else startJump()
    }, holdMs)
  }

  return {
    notifySeedsReady(header: LasHeader): void {
      if (started) return
      started = true
      run(header)
    },
    notifyChunkDecoded(chunk: DecodedChunk): void {
      recorder.recordDecode(chunk.chunkIndex, chunk.pointCount, {
        minX: chunk.minX, minY: chunk.minY, minZ: chunk.minZ,
        maxX: chunk.maxX, maxY: chunk.maxY, maxZ: chunk.maxZ,
      })
    },
    notifyChunkEvicted(chunkIndex: number): void {
      recorder.recordEviction(chunkIndex)
    },
  }
}
