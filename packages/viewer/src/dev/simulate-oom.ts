/**
 * Dev-only GPU out-of-memory simulator (?simOOM=MB) — lets the OOM backoff
 * and fault paths run on a capable GPU. Not part of the SDK.
 *
 * Patches GPUDevice.prototype so any createBuffer larger than the threshold
 * reports a genuine GPUOutOfMemoryError: into the innermost enclosing
 * 'out-of-memory' error scope if one is open (exactly where Dawn would route
 * a failed vkAllocateMemory), otherwise as an 'uncapturederror' event. The
 * returned buffer is a 4-byte stand-in, so nothing of the requested size is
 * actually allocated.
 *
 * The threshold is live: `__simOOM.thresholdMB = N` from the console lowers
 * it mid-session (e.g. then resize the window to exercise the runtime path).
 */

interface Scope { filter: GPUErrorFilter; simulated: GPUError | null }

export function installOomSimulator(thresholdMB: number): void {
  const state = { thresholdMB, hits: 0 }
  ;(window as unknown as Record<string, unknown>).__simOOM = state

  const proto = GPUDevice.prototype
  const origCreate = proto.createBuffer
  const origPush   = proto.pushErrorScope
  const origPop    = proto.popErrorScope
  const stacks = new WeakMap<GPUDevice, Scope[]>()
  const stackOf = (d: GPUDevice): Scope[] => {
    let s = stacks.get(d)
    if (!s) stacks.set(d, s = [])
    return s
  }

  proto.pushErrorScope = function (this: GPUDevice, filter: GPUErrorFilter) {
    stackOf(this).push({ filter, simulated: null })
    return origPush.call(this, filter)
  }
  proto.popErrorScope = async function (this: GPUDevice) {
    const scope = stackOf(this).pop()
    const real = await origPop.call(this)
    return real ?? scope?.simulated ?? null
  }
  proto.createBuffer = function (this: GPUDevice, desc: GPUBufferDescriptor) {
    if (desc.size > state.thresholdMB * 1024 * 1024) {
      state.hits++
      const err = new GPUOutOfMemoryError(
        `[simOOM] ${desc.label ?? 'buffer'} ${(desc.size / 1024 / 1024).toFixed(1)} MB ` +
        `> ${state.thresholdMB} MB threshold`)
      const scopes = stackOf(this)
      let target: Scope | undefined
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].filter === 'out-of-memory') { target = scopes[i]; break }
      }
      if (target) target.simulated ??= err
      else this.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', { error: err }))
      return origCreate.call(this, { ...desc, size: 4, mappedAtCreation: false })
    }
    return origCreate.call(this, desc)
  }
  console.warn(`[simOOM] simulating GPU out-of-memory above ${thresholdMB} MB`)
}
