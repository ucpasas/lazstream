/**
 * GPU memory budget negotiation — OOM backoff.
 *
 * Adapter/device limits (`maxBufferSize`, `maxStorageBufferBindingSize`)
 * describe what the GPU can ADDRESS, not what is currently FREE. On 4–6 GB
 * laptop GPUs and integrated GPUs a limit-sized ring buffer can fail the
 * underlying allocation (e.g. vkAllocateMemory), which WebGPU reports as an
 * 'out-of-memory' error and hands back an invalid buffer — every later use
 * of that buffer then cascades into validation errors.
 *
 * The renderer therefore allocates inside an 'out-of-memory' error scope and,
 * on failure, halves the budget and retries down to a floor. This module is
 * the pure retry policy — no WebGPU types.
 */

/** Resolved ring buffer budget, reported to the host app. */
export interface GpuMemoryBudget {
  /** Ring buffer size requested before any OOM backoff (bytes). */
  requestedBytes: number
  /** Ring buffer size actually allocated (bytes). */
  effectiveBytes: number
  /** True when effectiveBytes < requestedBytes because allocation failed. */
  reduced: boolean
  /** Allocation attempts made (1 = succeeded first try). */
  attempts: number
}

/** A GPU failure after initialisation. The renderer halts on either kind —
 *  the host app decides how to present it (and whether to reload). */
export type GpuFault =
  | { kind: 'out-of-memory'; message: string }
  | { kind: 'device-lost'; reason: string; message: string }

/**
 * Thrown by renderer/viewer creation when even the floor budget cannot be
 * allocated. Nothing is left allocated when this is thrown.
 */
export class GpuOutOfMemoryError extends Error {
  readonly floorBytes: number
  readonly attempts: number
  constructor(floorBytes: number, attempts: number) {
    super(
      `GPU out of memory: could not allocate a ${Math.round(floorBytes / 1024 / 1024)} MB ` +
      `point buffer after ${attempts} attempt(s). Close other GPU-heavy tabs or ` +
      `applications, or use a device with more GPU memory.`
    )
    this.name = 'GpuOutOfMemoryError'
    this.floorBytes = floorBytes
    this.attempts = attempts
  }
}

/** Storage buffer bindings must be 4-byte aligned. */
const alignDown4 = (n: number): number => Math.floor(n / 4) * 4

/**
 * Try `attempt(bytes)` starting at `initialBytes`, halving after each failure
 * (null result) until it succeeds or the next size would drop below
 * `floorBytes`. The floor itself is always tried once as the last attempt, so
 * the sequence for 2 GB / 128 MB is 2048 → 1024 → 512 → 256 → 128 MB.
 *
 * If `initialBytes` is already at or below the floor it is tried exactly once
 * (an explicit small override is honoured, never inflated).
 *
 * Throws GpuOutOfMemoryError when every attempt fails. `attempt` is
 * responsible for releasing anything it allocated before returning null.
 */
export async function allocateWithBackoff<T>(
  initialBytes: number,
  floorBytes: number,
  attempt: (bytes: number) => Promise<T | null>,
): Promise<{ value: T; budget: GpuMemoryBudget }> {
  const requestedBytes = alignDown4(initialBytes)
  const floor = Math.min(alignDown4(floorBytes), requestedBytes)
  if (!(floor > 0)) throw new RangeError(`invalid GPU budget floor: ${floorBytes}`)

  let bytes = requestedBytes
  let attempts = 0
  for (;;) {
    attempts++
    const value = await attempt(bytes)
    if (value !== null) {
      return {
        value,
        budget: {
          requestedBytes,
          effectiveBytes: bytes,
          reduced: bytes < requestedBytes,
          attempts,
        },
      }
    }
    if (bytes <= floor) throw new GpuOutOfMemoryError(floor, attempts)
    bytes = Math.max(floor, alignDown4(bytes / 2))
  }
}
