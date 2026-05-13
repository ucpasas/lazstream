/**
 * WebGPU context acquisition and feature detection.
 *
 * Separated from the renderer so feature detection can be queried independently
 * (e.g. to decide whether to use the WebGPU path or fall back to WebGL).
 *
 * WebGPU is not available when:
 *  - navigator.gpu is undefined (no browser support / disabled flag)
 *  - requestAdapter() returns null (no compatible GPU)
 *  - requestDevice() throws (device init failed)
 *
 * Constraint: a canvas can only have ONE context kind. If `getContext('webgl2')`
 * was called previously on this canvas, `getContext('webgpu')` will return null.
 * The app must construct the WebGPU renderer on a fresh canvas.
 */

export interface WebGPUContext {
  device: GPUDevice
  context: GPUCanvasContext
  canvasFormat: GPUTextureFormat
  canvas: HTMLCanvasElement
  /** Resolved max storage buffer size — what we actually got, not what we asked for. */
  maxStorageBufferBindingSize: number
  /** Was the device created with our preferred limits, or did we have to downgrade? */
  ringBufferCapacity: number
}

export class WebGPUUnsupportedError extends Error {
  constructor(reason: string) {
    super(`WebGPU unavailable: ${reason}`)
    this.name = 'WebGPUUnsupportedError'
  }
}

/**
 * Probe WebGPU availability without acquiring a device.
 * Cheap — safe to call early to decide on the rendering path.
 */
export async function isWebGPUSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

const PREFERRED_RING_CAPACITY = 256 * 1024 * 1024 // 256 MB
const FALLBACK_RING_CAPACITY  = 128 * 1024 * 1024 // 128 MB — default WebGPU limit

/**
 * Acquire a GPUDevice and configure the canvas's WebGPU context.
 *
 * Throws WebGPUUnsupportedError if the browser/GPU can't support our minimum
 * requirements. Callers should catch and fall back to the WebGL renderer.
 */
export async function createWebGPUContext(canvas: HTMLCanvasElement): Promise<WebGPUContext> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new WebGPUUnsupportedError('navigator.gpu is not defined')
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    throw new WebGPUUnsupportedError('no compatible GPU adapter')
  }

  // Try for a large storage buffer for our 256 MB ring.
  // Most discrete GPUs report 2 GB+ for maxStorageBufferBindingSize; integrated
  // GPUs report the default 128 MB. We negotiate: ask for 256, accept what we get.
  const desiredCapacity = Math.min(
    PREFERRED_RING_CAPACITY,
    adapter.limits.maxStorageBufferBindingSize,
  )

  let device: GPUDevice
  try {
    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: desiredCapacity,
        // The render-target depth/color storage buffers are sized as
        // viewport * 4 bytes — for 4K that's ~33 MB, well within defaults.
      },
    })
  } catch (err) {
    // Some adapters refuse the requested limits; retry with defaults.
    console.warn('[webgpu] device with preferred limits failed, falling back to defaults', err)
    device = await adapter.requestDevice()
  }

  const maxStorage = device.limits.maxStorageBufferBindingSize
  const ringBufferCapacity = Math.min(maxStorage, PREFERRED_RING_CAPACITY)
  if (ringBufferCapacity < FALLBACK_RING_CAPACITY) {
    throw new WebGPUUnsupportedError(
      `maxStorageBufferBindingSize ${maxStorage} is below minimum ${FALLBACK_RING_CAPACITY}`,
    )
  }

  // Watch for device loss. v1 logs only; v2 should re-create the device.
  device.lost.then((info) => {
    console.error('[webgpu] device lost', info.reason, info.message)
  })

  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new WebGPUUnsupportedError('canvas.getContext("webgpu") returned null')
  }

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format: canvasFormat,
    alphaMode: 'opaque',
  })

  return {
    device,
    context,
    canvasFormat,
    canvas,
    maxStorageBufferBindingSize: maxStorage,
    ringBufferCapacity,
  }
}