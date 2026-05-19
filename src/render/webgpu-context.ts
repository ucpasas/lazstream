/**
 * WebGPU context acquisition + capacity negotiation.
 *
 * Negotiates the highest ring-buffer-friendly storage limits the adapter
 * advertises, falling back gracefully if the device refuses. Capacity is
 * exposed as `ringBufferCapacity` so the renderer can size its point-data
 * ring buffer accordingly.
 *
 * Pre-Phase-3-follow-up: hardcoded 256 MB ring buffer → 374-slot cap →
 * 18.7M-point ceiling, regardless of available GPU memory.
 *
 * Post-Phase-3-follow-up: target 1 GB on discrete GPUs (~1500 slots,
 * ~75M points), graceful fallback to 256 MB or 128 MB on integrated GPUs
 * or restricted environments.
 */

export class WebGPUUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebGPUUnsupportedError'
  }
}

export interface WebGPUContext {
  device:  GPUDevice
  context: GPUCanvasContext
  canvas:  HTMLCanvasElement
  canvasFormat: GPUTextureFormat
  /** Point-data ring buffer size in bytes — negotiated from adapter limits. */
  ringBufferCapacity: number
  /** Diagnostic info for the stats overlay / debug. */
  limits: {
    adapterMaxStorageBufferBindingSize: number
    adapterMaxBufferSize:               number
    deviceMaxStorageBufferBindingSize:  number
    deviceMaxBufferSize:                number
  }
}

/**
 * Minimum acceptable ring buffer size. Below this, the depth+color
 * buffers at 4K resolution (already ~64 MB) leave so little room for
 * point data that the renderer can't usefully do its job. We refuse to
 * start in this case.
 */
const MIN_RING_BUFFER_BYTES = 128 * 1024 * 1024  // 128 MB

/**
 * Default target ring buffer size when caller doesn't specify. 2 GB is
 * comfortable on most discrete GPUs (NVIDIA RTX, AMD Radeon Pro etc.
 * advertise `maxStorageBufferBindingSize` around 2 GB). Integrated GPUs
 * may grant less and the negotiation falls back gracefully.
 *
 * At 700 KB/slot this gives ~2994 slots — close to but under the
 * MAX_SLOTS=4096 cap on the uniform pool in webgpu-renderer.ts.
 */
const DEFAULT_TARGET_RING_BUFFER_BYTES = 2 * 1024 * 1024 * 1024  // 2 GB

/**
 * Hard ceiling on requested capacity. With slotBytes=700 KB, this gives
 * exactly MAX_SLOTS=4096 ring buffer slots — any larger would exceed the
 * uniform pool and chunks beyond slot 4096 would fail to allocate
 * uniforms. Requesting above this clamps silently with a warning.
 */
const MAX_RING_BUFFER_BYTES = 4096 * 700_000  // ~2.87 GB

export interface CreateContextOptions {
  /**
   * Target ring buffer size in bytes. The actual negotiated capacity may
   * be less if the adapter doesn't advertise this much. Defaults to 2 GB.
   * Clamped to [128 MB, ~2.87 GB] before negotiation.
   */
  targetCapacityBytes?: number
}

export async function createWebGPUContext(
  canvas: HTMLCanvasElement,
  options: CreateContextOptions = {},
): Promise<WebGPUContext> {
  // Apply target + clamp.
  let target = options.targetCapacityBytes ?? DEFAULT_TARGET_RING_BUFFER_BYTES
  if (target < MIN_RING_BUFFER_BYTES) {
    console.warn(
      `[webgpu] targetCapacityBytes ${target} below floor ${MIN_RING_BUFFER_BYTES}; ` +
      `clamping to floor`
    )
    target = MIN_RING_BUFFER_BYTES
  }
  if (target > MAX_RING_BUFFER_BYTES) {
    console.warn(
      `[webgpu] targetCapacityBytes ${target} exceeds MAX_SLOTS-aware ceiling ` +
      `${MAX_RING_BUFFER_BYTES} (~2.87 GB); clamping. ` +
      `To go higher, bump MAX_SLOTS in webgpu-renderer.ts first.`
    )
    target = MAX_RING_BUFFER_BYTES
  }

  if (!('gpu' in navigator)) {
    throw new WebGPUUnsupportedError(
      'navigator.gpu not available — WebGPU disabled or unsupported in this browser'
    )
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    throw new WebGPUUnsupportedError(
      'navigator.gpu.requestAdapter() returned null — no compatible GPU found'
    )
  }

  // What the adapter ADVERTISES it can do. We won't ask for more than this;
  // requestDevice() would reject with OperationError if we did.
  const adapterMaxStorage = adapter.limits.maxStorageBufferBindingSize
  const adapterMaxBuffer  = adapter.limits.maxBufferSize

  // What we'll ASK for: clamp our target to what the adapter actually supports.
  // Both maxStorageBufferBindingSize and maxBufferSize must be at least the
  // ring buffer size — the buffer is bound as storage AND is a buffer object.
  const requestedStorage = Math.min(adapterMaxStorage, target)
  const requestedBuffer  = Math.min(adapterMaxBuffer,  target)

  // Try requesting the negotiated limits. If the device refuses (rare but
  // possible — e.g. driver quirks, GPU process restrictions), fall back to
  // the default device which gives us the conservative ~128 MB limits.
  let device: GPUDevice
  try {
    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: requestedStorage,
        maxBufferSize:               requestedBuffer,
      },
    })
  } catch (err) {
    console.warn(
      '[webgpu] device rejected expanded storage limits — falling back to defaults:',
      err
    )
    device = await adapter.requestDevice()
  }

  // What the DEVICE actually granted. This is the ceiling we work with;
  // anything larger would cause buffer allocation to fail validation.
  const deviceMaxStorage = device.limits.maxStorageBufferBindingSize
  const deviceMaxBuffer  = device.limits.maxBufferSize

  // Ring buffer capacity = the smaller of:
  //   - what the device's storage binding allows
  //   - what the device's buffer size allows
  //   - our (post-clamp) target (don't grow if we somehow got more)
  const ringBufferCapacity = Math.min(
    deviceMaxStorage,
    deviceMaxBuffer,
    target,
  )

  if (ringBufferCapacity < MIN_RING_BUFFER_BYTES) {
    throw new WebGPUUnsupportedError(
      `Device storage buffer limit too small: ${ringBufferCapacity} < ${MIN_RING_BUFFER_BYTES} ` +
      `(integrated GPU with restricted limits; try a discrete GPU)`
    )
  }

  // Diagnostic output — visible in console + useful for stats overlay
  console.debug('[webgpu] negotiated context:', {
    adapterMaxStorageMB:        Math.round(adapterMaxStorage / 1024 / 1024),
    adapterMaxBufferMB:         Math.round(adapterMaxBuffer  / 1024 / 1024),
    deviceMaxStorageMB:         Math.round(deviceMaxStorage  / 1024 / 1024),
    deviceMaxBufferMB:          Math.round(deviceMaxBuffer   / 1024 / 1024),
    ringBufferCapacityMB:       Math.round(ringBufferCapacity / 1024 / 1024),
    requestedTargetMB:          Math.round(target / 1024 / 1024),
  })

  // Acquire and configure the canvas context.
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) {
    throw new WebGPUUnsupportedError(
      'canvas.getContext("webgpu") returned null — WebGPU not available on this canvas'
    )
  }

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format: canvasFormat,
    alphaMode: 'premultiplied',
  })

  return {
    device,
    context,
    canvas,
    canvasFormat,
    ringBufferCapacity,
    limits: {
      adapterMaxStorageBufferBindingSize: adapterMaxStorage,
      adapterMaxBufferSize:               adapterMaxBuffer,
      deviceMaxStorageBufferBindingSize:  deviceMaxStorage,
      deviceMaxBufferSize:                deviceMaxBuffer,
    },
  }
}