/**
 * WebGPURenderer — Phase 2 Track B + Phase 3 Track C
 *
 * Drop-in replacement for the Track A WebGL validation renderer. Public
 * interface matches: loadSeedPoints, addDecodedChunk, getCameraWorldPosition,
 * getSceneCenter, dispose.
 *
 * Track C additions (frustum culling support for engine):
 *   - getFrustumWorldBBox3D()   : world-space AABB of the camera frustum
 *   - getFovY()                 : vertical FOV in radians (for SSE)
 *   - getCanvasHeight()         : current canvas pixel height (for SSE)
 *
 * The frustum extraction reuses the cached viewProj from writeCameraUniform()
 * — both are refreshed every frame, so the inverse is always up-to-date when
 * engine.updateCamera() queries it.
 *
 * Pipeline per frame:
 *  1. clear-depth compute: reset depth buffer to 0xFFFFFFFF sentinel
 *  2. points-depth compute: one dispatch per slot, projects + atomicMin
 *  3. resolve-edl render: fullscreen triangle reads depth/color, applies EDL
 *
 * See plan + wiki ([[Renderer]], [[WebGPU Compute]], [[Ring Buffer GPU Memory]])
 * for the design rationale.
 *
 * Vite note: the .wgsl ?raw imports require Vite to treat .wgsl as importable
 * text. This works out of the box in Vite 6 — no plugin needed — but if you've
 * customized `assetsInclude`, ensure '**\/*.wgsl' is allowed.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import depthShaderSrc   from './shaders/points-depth.wgsl?raw'
import clearShaderSrc   from './shaders/clear-depth.wgsl?raw'
import resolveShaderSrc from './shaders/resolve-edl.wgsl?raw'

import { createWebGPUContext, type WebGPUContext } from './webgpu-context'
export { WebGPUUnsupportedError } from './webgpu-context'
import { RingBufferAllocator } from './ring-buffer'
import {
  BYTES_PER_POINT,
  packChunk,
  packSeedsAsChunk,
  type SeedPoint,
} from './point-packing'
import type { RawPick } from './picking'
export type { RawPick } from './picking'
import { CLASS_LUT } from './colormaps'
import type { DecodedChunk, BBox3D, LasHeader, CameraState } from '@lazstream/core'

export type ColorMode = 'rgb' | 'height' | 'intensity' | 'classification'
const COLOR_MODE_VALUE: Record<ColorMode, number> = {
  rgb:            0,
  height:         1,
  intensity:      2,
  classification: 3,
}
const COLOR_PARAMS_BYTES = 32   // struct ColorParams: 8 × f32/u32

// --- Constants ---------------------------------------------------------------

/** Minimum valid GPUBuffer size; used as the pick buffer stub when picking is inactive. */
const PICK_STUB_SIZE = 4

const SEED_PSEUDO_CHUNK_INDEX = -1
const SEED_HIDE_THRESHOLD     = Infinity
/** Frames a slot must be invisible before proactive eviction.
 *  At 60 fps, 5 frames ≈ 83 ms — survives fast pans without excessive churn. */
const EVICT_GRACE_FRAMES      = 5      // keep seeds visible always — they provide the file-wide overview outline at every zoom level, useful when the ring buffer holds only a fraction of the file's chunks. Cost is trivial (one extra slot, ~7000 points per frame). Set to a finite number (e.g. 10) to hide seeds once N real chunks have landed.
const MAX_SLOTS               = 4096          // upper bound on simultaneous chunks
const COMPUTE_WORKGROUP_SIZE  = 128
const CLEAR_WORKGROUP_SIZE    = 256
const MAX_DPR                 = 2.0           // clamp devicePixelRatio
const CAMERA_FOV              = 60
const CAMERA_NEAR             = 0.1
const CAMERA_FAR              = 100_000


// Uniform buffer sizes (WGSL-aligned layouts — see shader files)
const CAMERA_UNIFORM_BYTES = 96   // mat4 + vec2 + pad + vec3 + pad
const CHUNK_UNIFORM_BYTES  = 32   // vec3 + u32 + vec3 + u32  (padded to stride)
const VIEWPORT_UNIFORM_BYTES = 16 // vec2 + f32 + f32

// --- Types -------------------------------------------------------------------

export interface WebGPURendererOptions {
  /** Override ring buffer size in bytes. Defaults to context.ringBufferCapacity. */
  ringBufferCapacity?: number
  edlStrength?: number   // default 200
  edlRadius?:   number   // default 1
  onFrame?:     (info: FrameInfo) => void
}

export interface FrameInfo {
  frame: number
  slots: number
  pointsLoaded: number
}

// =============================================================================
// WebGPURenderer
// =============================================================================

export class WebGPURenderer {
  // Context
  private readonly ctx: WebGPUContext
  private readonly device: GPUDevice

  // Pipelines + layouts
  private readonly clearPipeline:   GPUComputePipeline
  private readonly depthPipeline:   GPUComputePipeline
  private readonly resolvePipeline: GPURenderPipeline
  private readonly clearBindLayout:   GPUBindGroupLayout
  private readonly depthBindLayout:   GPUBindGroupLayout
  private readonly resolveBindLayout: GPUBindGroupLayout

  // Buffers — static (created once)
  private readonly ringBuffer:         GPUBuffer  // packed points, sized to ringBufferCapacity
  private readonly cameraUniform:      GPUBuffer  // CAMERA_UNIFORM_BYTES
  private readonly chunkUniform:       GPUBuffer  // MAX_SLOTS * CHUNK_UNIFORM_BYTES (storage array)
  private readonly viewportUniform:    GPUBuffer  // VIEWPORT_UNIFORM_BYTES
  private readonly visibleSlotListBuf: GPUBuffer  // MAX_SLOTS * 4 (u32 uniformIdx per visible slot)
  private readonly visibleSlotListScratch: Uint32Array  // CPU-side visible list, rebuilt each frame

  // Buffers — viewport-dependent (recreated on resize)
  private depthBuffer!: GPUBuffer
  private colorBuffer!: GPUBuffer
  // Pick buffer: viewport-sized u32 array when picking is active; 4-byte stub otherwise.
  // OOB writes from the depth shader to the stub are silently dropped by WebGPU.
  private pickBuffer!: GPUBuffer
  private viewportPixels = { w: 0, h: 0 }

  // Bind groups (recreated when their backing buffers change)
  private clearBindGroup!:   GPUBindGroup
  private depthBindGroup!:   GPUBindGroup
  private resolveBindGroup!: GPUBindGroup

  // Slot management
  private readonly slots: RingBufferAllocator
  private readonly freeUniformSlotIdxs: number[] // indices 0..MAX_SLOTS-1
  /** Map chunkIndex → uniform slot index (0..MAX_SLOTS-1). */
  private readonly chunkToUniformIdx = new Map<number, number>()
  /** Reverse map: uniform slot index → chunkIndex. Used to decode pick IDs (T2). */
  private readonly uniformIdxToChunkIndex = new Map<number, number>()

  /**
   * Chunks that arrived from decode but couldn't fit in the ring buffer at the
   * moment they landed (all 374 slots were touched by the just-completed render
   * frame → no LRU-evictable slot → allocate() returned null). They get retried
   * each renderFrame after the cull marks new slots stale.
   *
   * Why this is needed: the engine's back-pressure provider sees X stale slots
   * at frame N and dispatches ≤8 chunks. Those chunks travel through fetch +
   * worker decode for ~30 frames; by the time they arrive at the renderer, the
   * camera may have moved such that the previously-stale slots are now visible
   * again. Without the queue, the worker's decode work is thrown away and the
   * prioritiser has already marked the chunk as "decoded" so it can't be
   * re-dispatched in this session.
   *
   * Bounded — MAX_DEFERRED_CHUNKS caps memory at ~153 MB (256 × ~600 KB). Beyond
   * that, oldest chunks get dropped (the dispatch flow is faster than the
   * buffer can absorb).
   */
  private readonly MAX_DEFERRED_CHUNKS = 256
  private splatRadius = 2
  private deferredChunks: Array<{
    chunkIndex: number
    packed: Uint32Array
    pointCount: number
    min:   [number, number, number]
    range: [number, number, number]
  }> = []
  private deferredOverflowCount = 0

  // Camera + controls
  private readonly camera:   THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly sceneCenter = { x: 0, y: 0, z: 0 }
  // Pipeline timing accumulators — logged every TIMING_LOG_INTERVAL chunks
  private readonly TIMING_LOG_INTERVAL = 25
  private timingDecodeTotal = 0
  private timingPackTotal   = 0
  private timingChunkCount  = 0

  // Frame loop
  private currentFrame = 0
  private readonly lastViewProjElements = new Float32Array(16)
  private rafHandle: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposed = false
  private realChunkCount = 0
  // Dirty flag — true means GPU work is needed this frame. Set by:
  //   controls 'change' (camera moved or damping settling),
  //   addDecodedChunk (new data arrived),
  //   handleResize (viewport changed),
  //   loadSeedPoints (scene reset).
  // Cleared at the start of each GPU frame. False = skip all GPU passes.
  private needsRender = true
  // Set each frame by writeCameraUniform when the viewProj matrix changes.
  // Used by evictInvisibleSlots to suppress phantom-chunk eviction on a stationary camera.
  private frustumChangedThisFrame = true

  // Cached matrices (avoid allocs in render loop)
  private readonly viewProj = new THREE.Matrix4()
  private readonly cameraUniformView: Float32Array
  private readonly chunkUniformScratch: Float32Array  // single-slot view

  // Track C — frustum extraction scratch (reused each frame, no allocs)
  private readonly invViewProj    = new THREE.Matrix4()
  private readonly frustumCorners: THREE.Vector3[] =
    Array.from({ length: 8 }, () => new THREE.Vector3())

  // CPU-side frustum culling scratch (reused each frame). Three.js's
  // Frustum + Box3 do proper 6-plane vs AABB testing — much tighter than
  // the AABB-vs-frustum-AABB approximation, which is too loose at our
  // scene scale (CAMERA_FAR=100km, 60° FOV → frustum AABB ~115 km wide).
  private readonly cullFrustum = new THREE.Frustum()
  private readonly cullSlotBox = new THREE.Box3()

  // Scratch for isWorldBBoxVisible() — kept separate from the render cull's
  // scratch so a mid-frame diagnostic call can't corrupt an in-flight cull.
  private readonly benchFrustum = new THREE.Frustum()
  private readonly benchBox = new THREE.Box3()

  // Color mode
  private colorMode: ColorMode = 'height'
  private hasRGB = false
  private globalMinZ = 0
  private globalMaxZ = 1
  private readonly colorParamsBuffer: GPUBuffer  // ColorParams uniform, 32 bytes
  private readonly classLutBuffer: GPUBuffer     // classLUT storage, 256 * 4 bytes

  // Options
  private readonly edlStrength: number
  private readonly edlRadius: number
  private readonly onFrame?: (info: FrameInfo) => void
  private chunkEvictedCallback: ((chunkIndex: number) => void) | null = null

  // --- Picking (T1 + T2) ---------------------------------------------------

  /** Fires when the user clicks and a pick result is ready. Set to null to opt out. */
  onPointPicked: ((pick: RawPick | null) => void) | null = null

  /** True while pick-ID buffer maintenance (allocate + write + clear) is active. */
  private pickEnabled = false
  /** Debounce: ignore new clicks while a pick is already in flight. */
  private pickInFlight = false
  /** Staging buffer for depth readback (T1). 4 bytes, MAP_READ | COPY_DST. */
  private readonly pickDepthStaging: GPUBuffer
  /** Staging buffer for pick-ID readback (T2). 4 bytes, MAP_READ | COPY_DST. */
  private readonly pickIdStaging: GPUBuffer
  /** Snapshot of inverted viewProj at click time — avoids async-staleness artifacts. */
  private readonly pickViewProjInverse = new THREE.Matrix4()

  // --- Constructor / factory ------------------------------------------------

  private constructor(ctx: WebGPUContext, options: WebGPURendererOptions) {
    this.ctx = ctx
    this.device = ctx.device
    this.edlStrength = options.edlStrength ?? 600
    this.edlRadius   = options.edlRadius   ?? 1
    this.onFrame     = options.onFrame

    const ringCapacity = options.ringBufferCapacity ?? ctx.ringBufferCapacity
    this.slots = new RingBufferAllocator(ringCapacity)  // v2: variable-size free-list
    this.freeUniformSlotIdxs = Array.from({ length: MAX_SLOTS }, (_, i) => MAX_SLOTS - 1 - i)
    // (Stored as a stack — pop() returns lowest idx first since we built it
    //  reversed. Order doesn't actually matter; we just need O(1) get/release.)

    // --- Static buffers ---------------------------------------------------
    this.ringBuffer = this.device.createBuffer({
      label: 'lazstream/ring',
      size: ringCapacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.cameraUniform = this.device.createBuffer({
      label: 'lazstream/camera-uniform',
      size: CAMERA_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.chunkUniform = this.device.createBuffer({
      label: 'lazstream/chunk-uniform',
      size: MAX_SLOTS * CHUNK_UNIFORM_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.viewportUniform = this.device.createBuffer({
      label: 'lazstream/viewport-uniform',
      size: VIEWPORT_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.visibleSlotListBuf = this.device.createBuffer({
      label: 'lazstream/visible-slot-list',
      size: MAX_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.cameraUniformView      = new Float32Array(CAMERA_UNIFORM_BYTES / 4)
    this.chunkUniformScratch    = new Float32Array(CHUNK_UNIFORM_BYTES / 4)
    this.visibleSlotListScratch = new Uint32Array(MAX_SLOTS)

    // Color-mode buffers
    this.colorParamsBuffer = this.device.createBuffer({
      label: 'lazstream/color-params',
      size: COLOR_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.classLutBuffer = this.device.createBuffer({
      label: 'lazstream/class-lut',
      size: CLASS_LUT.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.classLutBuffer, 0, CLASS_LUT.buffer, CLASS_LUT.byteOffset, CLASS_LUT.byteLength)

    // Pick staging buffers (created once, 4 bytes each)
    this.pickDepthStaging = this.device.createBuffer({
      label: 'lazstream/pick-depth-staging',
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
    this.pickIdStaging = this.device.createBuffer({
      label: 'lazstream/pick-id-staging',
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    // --- Bind group layouts -----------------------------------------------
    this.clearBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/clear-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // pick buffer
      ],
    })

    this.depthBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/depth-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },        // pick buffer
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },        // colorParams
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // classLUT
      ],
    })

    this.resolveBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/resolve-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })

    // --- Pipelines --------------------------------------------------------
    const clearModule   = this.device.createShaderModule({ code: clearShaderSrc,   label: 'clear' })
    const depthModule   = this.device.createShaderModule({ code: depthShaderSrc,   label: 'points-depth' })
    const resolveModule = this.device.createShaderModule({ code: resolveShaderSrc, label: 'resolve-edl' })

    this.clearPipeline = this.device.createComputePipeline({
      label: 'lazstream/clear-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.clearBindLayout] }),
      compute: { module: clearModule, entryPoint: 'main' },
    })
    this.depthPipeline = this.device.createComputePipeline({
      label: 'lazstream/depth-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.depthBindLayout] }),
      compute: { module: depthModule, entryPoint: 'main' },
    })
    this.resolvePipeline = this.device.createRenderPipeline({
      label: 'lazstream/resolve-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.resolveBindLayout] }),
      vertex:   { module: resolveModule, entryPoint: 'vs_main' },
      fragment: { module: resolveModule, entryPoint: 'fs_main',
                  targets: [{ format: ctx.canvasFormat }] },
      primitive: { topology: 'triangle-list' },
    })

    // --- Camera + controls ------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
    this.camera.position.set(0, 0, 1000)
    this.camera.up.set(0, 0, 1) // Z-up for geospatial data

    this.controls = new OrbitControls(this.camera, ctx.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.addEventListener('change', () => {
      this.needsRender = true
      // Keep clip planes relative to view distance to avoid z-fighting when
      // zooming into dense TLS scans or very large aerial tiles.
      const dist = this.camera.position.distanceTo(this.controls.target)
      this.camera.near = Math.max(dist * 0.001, 0.01)
      this.camera.far  = Math.max(dist * 10, 1000)
      this.camera.updateProjectionMatrix()
    })

    // --- Viewport setup ---------------------------------------------------
    this.handleResize(ctx.canvas.clientWidth, ctx.canvas.clientHeight)
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect
        this.handleResize(cr.width, cr.height)
      }
    })
    this.resizeObserver.observe(ctx.canvas)

    // --- Picking click listener -------------------------------------------
    ctx.canvas.addEventListener('pointerdown', this.handleCanvasClick)

    // --- Start frame loop -------------------------------------------------
    this.writeViewportUniform()
    this.writeColorParams()
    this.rafHandle = requestAnimationFrame(this.renderFrame)
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: WebGPURendererOptions = {},
  ): Promise<WebGPURenderer> {
    // ringBufferCapacity, if specified, both:
    //   (a) tells the context to negotiate that much from the adapter
    //   (b) overrides the actual ring buffer size used by the renderer
    // If not specified, the context negotiates its default (2 GB target).
    const ctx = await createWebGPUContext(canvas, {
      targetCapacityBytes: options.ringBufferCapacity,
    })
    return new WebGPURenderer(ctx, options)
  }

  // --- Public API -----------------------------------------------------------

  loadSeedPoints(seeds: SeedPoint[], header?: LasHeader): void {
    if (this.disposed) return
    this.needsRender = true

    const packed = packSeedsAsChunk(seeds)
    if (packed.pointCount === 0) return

    // Capture color-relevant header fields and write the initial ColorParams.
    if (header) {
      const pdrf = header.pointDataRecordFormat
      this.hasRGB   = pdrf === 2 || pdrf === 3 || pdrf === 5 || pdrf === 7 || pdrf === 8 || pdrf === 10
      this.globalMinZ = header.minZ
      this.globalMaxZ = header.maxZ
      // Default mode: rgb if the file has native colour, else height.
      this.colorMode = this.hasRGB ? 'rgb' : 'height'
      this.writeColorParams()
      console.debug(
        `[color] available modes: ${this.getAvailableColorModes().join(', ')}  ` +
        `default=${this.colorMode}`
      )
    }

    // Camera framing: prefer the LAS header bbox (authoritative — covers
    // every point in the file, not just sampled seeds). Falls back to the
    // seed-derived bbox if the header isn't available (older callers).
    const bbox = header
      ? {
          min: [header.minX, header.minY, header.minZ] as const,
          max: [header.maxX, header.maxY, header.maxZ] as const,
          range: [
            header.maxX - header.minX,
            header.maxY - header.minY,
            header.maxZ - header.minZ,
          ] as const,
        }
      : {
          min: packed.min,
          max: [
            packed.min[0] + packed.range[0],
            packed.min[1] + packed.range[1],
            packed.min[2] + packed.range[2],
          ] as const,
          range: packed.range,
        }

    // Set sceneCenter to the model's geometric centre so all downstream math
    // (camera, frustum cull, GPU dequantization) operates relative to it.
    this.sceneCenter.x = bbox.min[0] + bbox.range[0] / 2
    this.sceneCenter.y = bbox.min[1] + bbox.range[1] / 2
    this.sceneCenter.z = 1

    this.addPackedData(
      SEED_PSEUDO_CHUNK_INDEX,
      packed.packed,
      packed.pointCount,
      packed.min,
      packed.range,
    )
  }

  addDecodedChunk(chunk: DecodedChunk): void {
    if (this.disposed) return
    this.needsRender = true

    const packT0 = performance.now()
    const packed = packChunk(chunk)
    const packMs = performance.now() - packT0

    this.timingDecodeTotal += chunk.decodeMs
    this.timingPackTotal   += packMs
    this.timingChunkCount++
    if (this.timingChunkCount % this.TIMING_LOG_INTERVAL === 0) {
      const n = this.TIMING_LOG_INTERVAL
      console.debug(
        `[lazstream/timing] last ${n} chunks — ` +
        `decode avg ${(this.timingDecodeTotal / n).toFixed(1)} ms  ` +
        `pack avg ${(this.timingPackTotal / n).toFixed(2)} ms`
      )
      this.timingDecodeTotal = 0
      this.timingPackTotal   = 0
    }

    const min: [number, number, number]   = [chunk.minX, chunk.minY, chunk.minZ]
    const range: [number, number, number] = [
      (chunk.maxX - chunk.minX) || 1,
      (chunk.maxY - chunk.minY) || 1,
      (chunk.maxZ - chunk.minZ) || 1,
    ]

    if (this.addPackedData(chunk.chunkIndex, packed, chunk.pointCount, min, range)) {
      this.realChunkCount++
      if (this.realChunkCount === SEED_HIDE_THRESHOLD) {
        this.releaseSlot(SEED_PSEUDO_CHUNK_INDEX)
      }
      return
    }

    // Couldn't fit right now. Defer: each renderFrame retries the queue
    // after the cull may have freed an LRU slot. Bounded queue length;
    // overflow drops the oldest deferred chunk and increments a counter.
    if (this.deferredChunks.length >= this.MAX_DEFERRED_CHUNKS) {
      const dropped = this.deferredChunks.shift()!
      this.deferredOverflowCount++
      // Notify engine so the dropped chunk can be re-queued when the camera
      // returns to it (same path as proactive GPU eviction).
      this.chunkEvictedCallback?.(dropped.chunkIndex)
      if (this.deferredOverflowCount % 25 === 1) {
        console.warn(
          `[webgpu] deferred queue overflow: ${this.deferredOverflowCount} chunks dropped ` +
          `(will re-fetch when camera revisits)`
        )
      }
    }
    this.deferredChunks.push({
      chunkIndex: chunk.chunkIndex,
      packed,
      pointCount: chunk.pointCount,
      min,
      range,
    })
  }

  /**
   * Retry queued chunks that previously couldn't fit. Called from renderFrame
   * AFTER the depth compute pass so slot.lastRenderedFrame reflects the
   * just-completed frame's visibility — LRU-evictable slots are the ones not
   * touched this frame, which is what we want to overwrite.
   *
   * Stops at the first chunk that still can't fit — a failed allocate() means
   * all evictable slots have been exhausted (every remaining slot was visible
   * this frame), so subsequent allocations in the same frame will also fail.
   * Cheap when the queue is empty (common case).
   */
  private flushDeferredChunks(): void {
    while (this.deferredChunks.length > 0) {
      const d = this.deferredChunks[0]!
      if (!this.addPackedData(d.chunkIndex, d.packed, d.pointCount, d.min, d.range)) break
      this.deferredChunks.shift()
      this.realChunkCount++
      if (this.realChunkCount === SEED_HIDE_THRESHOLD) {
        this.releaseSlot(SEED_PSEUDO_CHUNK_INDEX)
      }
    }
  }

  /** Current deferred queue depth — for stats overlay diagnostics. */
  getDeferredCount(): number {
    return this.deferredChunks.length
  }

  getCameraWorldPosition(): { x: number; y: number; z: number } {
    return {
      x: this.camera.position.x + this.sceneCenter.x,
      y: this.camera.position.y + this.sceneCenter.y,
      z: this.camera.position.z + this.sceneCenter.z,
    }
  }

  getSceneCenter(): { x: number; y: number; z: number } {
    return { ...this.sceneCenter }
  }

  /**
   * Ring buffer state for engine back-pressure (Phase 3 Track A — Step 6).
   *
   * `slotsFree` here means "slots `allocate()` could fulfill right now" —
   * not just untouched free slots. Once the buffer fills the first time,
   * the freeStack is empty forever; making progress means LRU-evicting
   * stale slots. Reports the combined count so the engine can dispatch
   * fresh chunks when stale ones are ready to be replaced.
   *
   * Cheap O(slotCount) — called once per engine tick.
   */
  getRingBufferStatus(): { slotsFree: number; slotsTotal: number } {
    return {
      slotsFree: this.slots.getAvailableCount(this.currentFrame),
      // slotsTotal: estimated capacity in avg-sized chunks (self-tuning; cold = DEFAULT_MAX_CHUNK_BYTES)
      slotsTotal: Math.floor(this.slots.capacity / this.slots.avgChunkBytes()),
    }
  }

  /**
   * Clear all rendered state so the next file load starts from a clean slate.
   *
   * Called by main.ts at the top of loadUrl() — before the engine begins
   * fetching the new file's header. Without this, the renderer accumulates
   * state across loads: previous file's chunks live in the ring buffer
   * until LRU eviction reclaims them, and they're positioned relative to
   * the previous sceneCenter so they render in the wrong place.
   *
   * What gets reset:
   *   - Ring buffer slot table → empty (next allocations start from offset 0)
   *   - Uniform slot allocator → all MAX_SLOTS free
   *   - chunkIndex → uniform-slot map → empty
   *   - sceneCenter → 0,0,0 (next loadSeedPoints establishes new origin)
   *   - realChunkCount → 0 (SEED_HIDE_THRESHOLD counter restarts)
   *
   * What stays:
   *   - GPU buffers (ring, depth, color) — their contents are orphaned but
   *     don't render because the depth buffer is cleared per-frame and an
   *     empty slot table means no compute pass writes new depth/color
   *   - Camera position — loadSeedPoints() re-fits when new seeds arrive.
   *     If the new load fails before seeds, user sees a blank canvas at
   *     the old camera angle; better than seeing stale data.
   */
  reset(): void {
    if (this.disposed) return

    // CPU-side slot bookkeeping → empty
    this.slots.clear()
    this.chunkToUniformIdx.clear()

    // Uniform-slot allocator → all-free (mirror constructor's initialiser)
    this.freeUniformSlotIdxs.length = 0
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.freeUniformSlotIdxs.push(MAX_SLOTS - 1 - i)
    }

    // Pick reverse-lookup map → empty (mirrors chunkToUniformIdx)
    this.uniformIdxToChunkIndex.clear()

    // Scene origin → 0; next loadSeedPoints() sets it from new seed bbox
    this.sceneCenter.x = 0
    this.sceneCenter.y = 0
    this.sceneCenter.z = 0

    // Seed-hide counter restarts
    this.realChunkCount = 0

    // Deferred-chunk queue → empty (any in-flight from previous load is moot)
    this.deferredChunks = []
    this.deferredOverflowCount = 0

    // Timing accumulators → reset for fresh load
    this.timingDecodeTotal = 0
    this.timingPackTotal   = 0
    this.timingChunkCount  = 0

  }

  /** Force one more render pass. Call when the engine transitions to 'streaming'
   *  so that onFrame fires and calls updateCamera() with workers now configured. */
  requestRender(): void {
    this.needsRender = true
  }

  /**
   * Auto-position the camera so the full point cloud is visible from a natural
   * oblique angle. Must be called after loadSeedPoints() (which sets sceneCenter).
   *
   * For aerial LiDAR (flat XY-dominant bbox) the elevation is 35°.
   * For TLS / indoor scans (Z-dominant bbox) the elevation drops to 25° to
   * show more of the vertical structure.
   *
   * The orbit target is the 3D centroid of the header bbox in scene-local coords
   * (not just the XY centre at z=0, which misses tall scenes).
   */
  fitCameraToHeader(header: LasHeader): void {
    // Scene-relative bounds — sceneCenter already set by loadSeedPoints()
    const minX = header.minX - this.sceneCenter.x
    const maxX = header.maxX - this.sceneCenter.x
    const minY = header.minY - this.sceneCenter.y
    const maxY = header.maxY - this.sceneCenter.y
    const minZ = header.minZ - this.sceneCenter.z
    const maxZ = header.maxZ - this.sceneCenter.z

    // 3D centroid — orbit target
    const target = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    )

    // Diagonal of the full bounding box (floor at 1 m for degenerate files)
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ
    const diagonal = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1)

    // Distance: fit the full diagonal in the vertical FOV with 1.5× padding
    const fovY = this.camera.fov * (Math.PI / 180)
    const distance = Math.max((diagonal / 2) / Math.tan(fovY / 2) * 1.1, 1)

    // Lower elevation for vertically-dominant scenes (TLS, tall buildings)
    const isVerticallyDominant = dz > Math.max(dx, dy) * 0.5
    const elevationDeg = isVerticallyDominant ? 25 : 35
    const elevation = elevationDeg * (Math.PI / 180)
    const azimuth = Math.PI / 4  // 45° (NE — offset from south to show both faces)

    // Offset from target in scene space (Z-up)
    const camOffset = new THREE.Vector3(
      distance * Math.cos(elevation) * Math.cos(azimuth),
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
    )

    this.camera.position.copy(target).add(camOffset)
    this.controls.target.copy(target)

    // Initial clip planes relative to view distance
    this.camera.near = Math.max(distance * 0.001, 0.01)
    this.camera.far  = Math.max(distance * 10, 1000)
    this.camera.updateProjectionMatrix()

    this.controls.update()
    this.needsRender = true
  }

  // --- Track C: camera + frustum providers -----------------------------------

  /** Vertical field of view, in radians. Used by the engine's SSE calc. */
  getFovY(): number {
    return this.camera.fov * (Math.PI / 180)
  }

  /** Current canvas height in pixels (after DPR scaling). Used by SSE calc. */
  getCanvasHeight(): number {
    return this.viewportPixels.h
  }

  /** Set point splat size. 1 = 1×1 px (default), 2 = 3×3, 3 = 5×5. */
  setSplatRadius(n: number): void {
    this.splatRadius = Math.max(1, Math.round(n))
  }

  setColorMode(mode: ColorMode): ColorMode {
    const resolved: ColorMode = (mode === 'rgb' && !this.hasRGB) ? 'height' : mode
    if (this.colorMode === resolved) return resolved
    this.colorMode = resolved
    this.writeColorParams()
    this.needsRender = true
    if (resolved !== mode) {
      console.debug(`[color] mode=${resolved} (requested ${mode}→resolved)`)
    } else {
      console.debug(`[color] mode=${resolved}`)
    }
    return resolved
  }

  get currentColorMode(): ColorMode { return this.colorMode }

  getAvailableColorModes(): ColorMode[] {
    const modes: ColorMode[] = ['height', 'intensity', 'classification']
    if (this.hasRGB) modes.unshift('rgb')
    return modes
  }

  private writeColorParams(): void {
    const buf = new ArrayBuffer(COLOR_PARAMS_BYTES)
    const dv  = new DataView(buf)
    dv.setUint32( 0, COLOR_MODE_VALUE[this.colorMode], true)
    dv.setUint32( 4, 0, true)                                         // _pad0
    dv.setFloat32(8,  this.globalMinZ, true)
    dv.setFloat32(12, this.globalMaxZ, true)
    dv.setFloat32(16, 0.0, true)                                       // intensityLo identity
    dv.setFloat32(20, 1.0, true)                                       // intensityHi identity
    dv.setFloat32(24, 0.0, true)                                       // _pad1.x
    dv.setFloat32(28, 0.0, true)                                       // _pad1.y
    this.device.queue.writeBuffer(this.colorParamsBuffer, 0, buf)
  }

  /**
   * Enable or disable the pick-ID G-buffer (T2).
   *
   * When enabled, each frame the pick buffer is allocated at full viewport size
   * (~33 MB at 4K) and cleared to sentinel alongside the depth buffer.
   * The depth shader writes an encoded (uniformIdx | pointIndex) ID per pixel
   * in the atomicMin win-branch. Canvas clicks trigger a depth + ID readback,
   * and `onPointPicked` fires with the decoded world position and chunk identity.
   *
   * When disabled (default), the pick buffer is a 4-byte stub — the shader still
   * writes to binding 6 but all writes are silently dropped as OOB by WebGPU.
   * T1 (world position from depth) is always available on click regardless of
   * this flag; only T2 (identity) requires it.
   */
  setPickingEnabled(enabled: boolean): void {
    if (this.pickEnabled === enabled) return
    this.pickEnabled = enabled
    this.pickBuffer.destroy()
    const { w, h } = this.viewportPixels
    const size = enabled ? Math.max(PICK_STUB_SIZE, w * h * 4) : PICK_STUB_SIZE
    this.pickBuffer = this.device.createBuffer({
      label: 'lazstream/pick',
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.rebuildBindGroups()
    this.needsRender = true
  }

  /**
   * Canvas pointerdown → async depth (T1) + optional pick-ID (T2) readback.
   *
   * Debounced: concurrent clicks are silently ignored while a pick is in flight.
   * Snapshots `viewProjInverse` at copy time so the async `mapAsync` resolution
   * uses the matrix that generated the rendered depth values.
   *
   * Depth NDC assumption: the shader clips ndc.z to [0,1] and stores it via
   * bitcast<u32>. Three.js PerspectiveCamera uses OpenGL-style projection
   * (clip-space z in [-1,1]), so we remap: ndcZ = storedDepth * 2 - 1.
   */
  private handleCanvasClick = async (e: PointerEvent): Promise<void> => {
    if (this.pickInFlight || this.disposed || !this.onPointPicked) return
    this.pickInFlight = true

    let depthMapped = false
    let idMapped    = false

    try {
      const rect = this.ctx.canvas.getBoundingClientRect()
      console.debug('[picking] pointerdown', { clientX: e.clientX, clientY: e.clientY, rect })
      const dpr  = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const cssX = e.clientX - rect.left
      const cssY = e.clientY - rect.top
      const px   = Math.floor(cssX * dpr)
      const py   = Math.floor(cssY * dpr)
      const { w, h } = this.viewportPixels
      if (px < 0 || px >= w || py < 0 || py >= h) {
        this.onPointPicked(null)
        return
      }

      // Snapshot view-projection inverse at submit time (async-staleness fix).
      // viewProj is refreshed each frame in writeCameraUniform().
      this.pickViewProjInverse.copy(this.viewProj).invert()
      const snapCX = this.sceneCenter.x
      const snapCY = this.sceneCenter.y
      const snapCZ = this.sceneCenter.z
      const snapW  = w
      const snapH  = h

      const pixelIdx = py * w + px
      const enc = this.device.createCommandEncoder({ label: 'pick' })
      enc.copyBufferToBuffer(this.depthBuffer, pixelIdx * 4, this.pickDepthStaging, 0, 4)
      if (this.pickEnabled) {
        enc.copyBufferToBuffer(this.pickBuffer, pixelIdx * 4, this.pickIdStaging, 0, 4)
      }
      this.device.queue.submit([enc.finish()])

      const mapPromises: Promise<void>[] = [
        this.pickDepthStaging.mapAsync(GPUMapMode.READ),
      ]
      if (this.pickEnabled) {
        mapPromises.push(this.pickIdStaging.mapAsync(GPUMapMode.READ))
      }
      await Promise.all(mapPromises)
      if (this.disposed) return   // renderer torn down while awaiting
      depthMapped = true
      if (this.pickEnabled) idMapped = true

      const depthU32 = new Uint32Array(this.pickDepthStaging.getMappedRange())[0]!
      console.debug('[picking] depthU32=0x' + depthU32.toString(16).padStart(8, '0'),
        depthU32 === 0xFFFFFFFF ? '(miss — background)' : '(hit)')
      if (depthU32 === 0xFFFFFFFF) {
        this.onPointPicked(null)
        return
      }

      // Bit-cast u32 back to the float that the shader stored (ndc.z ∈ [0,1]).
      const depthF = new Float32Array(new Uint32Array([depthU32]).buffer)[0]!

      // NDC from pixel coordinates
      const ndcX =  (px / snapW) * 2 - 1
      const ndcY = -(py / snapH) * 2 + 1
      // Remap [0,1] depth to OpenGL NDC [-1,1] for Three.js projectionMatrix inverse.
      const ndcZ = depthF * 2 - 1

      const clip = new THREE.Vector4(ndcX, ndcY, ndcZ, 1)
        .applyMatrix4(this.pickViewProjInverse)
      clip.divideScalar(clip.w)

      const worldPos = {
        x: clip.x + snapCX,
        y: clip.y + snapCY,
        z: clip.z + snapCZ,
      }

      let chunkIndex      = -1
      let localPointIndex = -1

      if (this.pickEnabled && idMapped) {
        const pickId = new Uint32Array(this.pickIdStaging.getMappedRange())[0]!
        if (pickId !== 0xFFFFFFFF) {
          const uniformIdx = pickId >>> 19
          localPointIndex  = pickId & 0x7FFFF
          chunkIndex       = this.uniformIdxToChunkIndex.get(uniformIdx) ?? -1
        }
      }

      this.onPointPicked({
        worldPos,
        screenPos: { x: cssX, y: cssY },
        chunkIndex,
        localPointIndex,
      })
    } catch (err) {
      console.error('[picking] error during pick readback:', err)
    } finally {
      try { if (depthMapped) this.pickDepthStaging.unmap() } catch { /* disposed */ }
      try { if (idMapped)    this.pickIdStaging.unmap()    } catch { /* disposed */ }
      this.pickInFlight = false
    }
  }

  /**
   * World-space 3D AABB of the camera's view frustum. Used by
   * SpatialIndex.queryFrustum() to gate chunk decode requests.
   *
   * Reuses the viewProj matrix computed in writeCameraUniform() each frame,
   * so this is cheap to call from updateCamera() in the engine.
   *
   * Coordinate system: the renderer internally works in scene-local
   * coordinates (world XYZ minus sceneCenter). We unproject NDC corners
   * to scene-local, then offset by sceneCenter to return WORLD coords —
   * what the spatial index stores.
   */
  getFrustumWorldBBox3D(): BBox3D {
    // viewProj was already composed this frame in writeCameraUniform().
    // Invert into a separate matrix so we don't corrupt the cached viewProj.
    this.invViewProj.copy(this.viewProj).invert()

    // 8 NDC cube corners. Three.js uses OpenGL-style NDC depth [-1, 1] for
    // its Matrix4.invert() + Vector3.applyMatrix4 unprojection path, even
    // when targeting WebGPU canvases — projectionMatrix.invert() internally
    // handles the WebGPU [0,1] → [-1,1] depth mapping transparently.
    const ndcNear = -1
    const ndcFar  =  1
    this.frustumCorners[0].set(-1, -1, ndcNear)
    this.frustumCorners[1].set( 1, -1, ndcNear)
    this.frustumCorners[2].set(-1,  1, ndcNear)
    this.frustumCorners[3].set( 1,  1, ndcNear)
    this.frustumCorners[4].set(-1, -1, ndcFar)
    this.frustumCorners[5].set( 1, -1, ndcFar)
    this.frustumCorners[6].set(-1,  1, ndcFar)
    this.frustumCorners[7].set( 1,  1, ndcFar)

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (let i = 0; i < 8; i++) {
      const c = this.frustumCorners[i]
      c.applyMatrix4(this.invViewProj)
      const wx = c.x + this.sceneCenter.x
      const wy = c.y + this.sceneCenter.y
      const wz = c.z + this.sceneCenter.z
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wz < minZ) minZ = wz
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
      if (wz > maxZ) maxZ = wz
    }

    return { minX, minY, minZ, maxX, maxY, maxZ }
  }

  /**
   * Exact 6-plane frustum vs world-space AABB test against the current
   * camera. Diagnostic/benchmark use (camera-bench wasted-fetch metric) —
   * same plane-vs-box test as the per-slot render cull, so "visible" here
   * matches what the compute pass would actually draw.
   */
  isWorldBBoxVisible(bbox: BBox3D): boolean {
    // viewProj is scene-local (see cull in renderFrame); convert the box.
    this.benchFrustum.setFromProjectionMatrix(this.viewProj)
    this.benchBox.min.set(
      bbox.minX - this.sceneCenter.x,
      bbox.minY - this.sceneCenter.y,
      bbox.minZ - this.sceneCenter.z,
    )
    this.benchBox.max.set(
      bbox.maxX - this.sceneCenter.x,
      bbox.maxY - this.sceneCenter.y,
      bbox.maxZ - this.sceneCenter.z,
    )
    return this.benchFrustum.intersectsBox(this.benchBox)
  }

  /** Return the current camera state in world coordinates for view-state sharing. */
  getCameraState(): CameraState {
    return {
      x:  this.camera.position.x + this.sceneCenter.x,
      y:  this.camera.position.y + this.sceneCenter.y,
      z:  this.camera.position.z + this.sceneCenter.z,
      tx: this.controls.target.x + this.sceneCenter.x,
      ty: this.controls.target.y + this.sceneCenter.y,
      tz: this.controls.target.z + this.sceneCenter.z,
      fovY: this.camera.fov * (Math.PI / 180),
    }
  }

  /**
   * Restore camera from a saved CameraState.
   * Must be called after loadSeedPoints() — sceneCenter must already be set
   * or the world→scene-local conversion will be wrong.
   */
  applyCameraState(state: CameraState): void {
    this.camera.position.set(
      state.x  - this.sceneCenter.x,
      state.y  - this.sceneCenter.y,
      state.z  - this.sceneCenter.z,
    )
    this.controls.target.set(
      state.tx - this.sceneCenter.x,
      state.ty - this.sceneCenter.y,
      state.tz - this.sceneCenter.z,
    )
    this.camera.fov = state.fovY * (180 / Math.PI)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle)
    this.resizeObserver?.disconnect()
    this.ctx.canvas.removeEventListener('pointerdown', this.handleCanvasClick)
    this.controls.dispose()
    // GPU resources are released when the device is GC'd. We explicitly
    // destroy() the larger buffers to release device memory eagerly.
    this.ringBuffer.destroy()
    this.depthBuffer.destroy()
    this.colorBuffer.destroy()
    this.pickBuffer.destroy()
    this.pickDepthStaging.destroy()
    this.pickIdStaging.destroy()
    this.cameraUniform.destroy()
    this.chunkUniform.destroy()
    this.viewportUniform.destroy()
    this.colorParamsBuffer.destroy()
    this.classLutBuffer.destroy()
    // Note: we don't `device.destroy()` because the canvas may outlive us
    // and another renderer instance might re-use the device.
  }

  // --- Internal: slot + buffer management -----------------------------------

  /**
   * Allocate a slot, upload the packed point data, and write the per-slot
   * uniform entry. Returns false if the data couldn't fit (no allocatable
   * slots in the ring) — caller should silently drop and try later.
   */
  private addPackedData(
    chunkIndex: number,
    packedPoints: Uint32Array,
    pointCount: number,
    min:   [number, number, number],
    range: [number, number, number],
  ): boolean {
    if (this.freeUniformSlotIdxs.length === 0) {
      console.warn(`[webgpu] no free uniform slot for chunk ${chunkIndex} — dropped`)
      return false
    }

    const byteLength = pointCount * BYTES_PER_POINT
    const result = this.slots.allocate(
      chunkIndex, byteLength, pointCount, min, range, this.currentFrame,
    )
    if (!result) {
      // Permanent rejection: chunk too large for total buffer capacity. Drop it.
      return false
    }

    // Process all defrag-by-eviction casualties regardless of allocation success.
    // Invariant 10: evictions from allocate() must clear the same three sets as
    // proactive eviction — otherwise orphaned chunks never get re-fetched.
    for (const evicted of result.evicted) {
      const idx = this.chunkToUniformIdx.get(evicted.chunkIndex)
      if (idx !== undefined) {
        this.freeUniformSlotIdxs.push(idx)
        this.chunkToUniformIdx.delete(evicted.chunkIndex)
      }
      this.chunkEvictedCallback?.(evicted.chunkIndex)
    }
    if (result.evicted.length > 0) {
      console.debug(`[ring-buffer] defrag: evicted ${result.evicted.length} slot(s) to fit chunk ${chunkIndex}`)
    }

    if (!result.slot) {
      // All slots were visible this frame — deferred queue will retry next frame
      // once the cull marks some slots as non-visible.
      return false
    }

    // Assign a fresh uniform slot.
    const uniformIdx = this.freeUniformSlotIdxs.pop()!
    this.chunkToUniformIdx.set(chunkIndex, uniformIdx)
    this.uniformIdxToChunkIndex.set(uniformIdx, chunkIndex)

    // Upload point data into the ring buffer at the allocated byte offset.
    this.device.queue.writeBuffer(
      this.ringBuffer,
      result.slot.byteOffset,
      packedPoints.buffer,
      packedPoints.byteOffset,
      packedPoints.byteLength,
    )

    // Write the chunk uniform. Stride is per-device alignment (256 typically).
    const u = this.chunkUniformScratch
    u[0] = min[0]; u[1] = min[1]; u[2] = min[2]
    // word 3 (u32 reinterpret of float bits) — pointCount. Pack as int via DataView later.
    // For brevity: write floats now, overwrite words 3 and 7 with u32 via a sibling DataView.
    u[4] = range[0]; u[5] = range[1]; u[6] = range[2]
    // word 7 = pointStrideOffset (u32)
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength)
    dv.setUint32(12, pointCount, true)
    dv.setUint32(28, result.slot.byteOffset / 4, true) // pointStrideOffset in u32s
    // Zero the rest to be safe (alignment padding).
    for (let i = 8; i < u.length; i++) u[i] = 0

    this.device.queue.writeBuffer(
      this.chunkUniform,
      uniformIdx * CHUNK_UNIFORM_BYTES,
      u.buffer,
      u.byteOffset,
      CHUNK_UNIFORM_BYTES,
    )

    return true
  }

  private releaseSlot(chunkIndex: number): void {
    const uniformIdx = this.chunkToUniformIdx.get(chunkIndex)
    if (uniformIdx !== undefined) {
      this.freeUniformSlotIdxs.push(uniformIdx)
      this.chunkToUniformIdx.delete(chunkIndex)
      this.uniformIdxToChunkIndex.delete(uniformIdx)
    }
    this.slots.remove(chunkIndex)
  }

  /** Register a callback invoked when a chunk is proactively evicted because
   *  it has been invisible for EVICT_GRACE_FRAMES consecutive frames.
   *  The engine uses this to remove the chunk from its decoded set so it will
   *  be re-fetched when the camera returns. */
  setChunkEvictedCallback(cb: (chunkIndex: number) => void): void {
    this.chunkEvictedCallback = cb
  }

private evictInvisibleSlots(): void {
    const threshold = this.currentFrame - EVICT_GRACE_FRAMES
    const toEvict: number[] = []
    for (const slot of this.slots.getSlots()) {
      if (slot.chunkIndex === SEED_PSEUDO_CHUNK_INDEX) continue
      if (slot.lastRenderedFrame >= threshold) continue

      // Phantom chunks — in the engine's loose AABB frustum but outside the
      // renderer's exact 6-plane frustum — are never touch()ed. On a stationary
      // camera they would be evicted, immediately re-fetched (still in bbox), and
      // cycle indefinitely. Skip them unless the frustum actually changed this
      // frame (camera moved), which means the chunk genuinely left view.
      if (!slot.everRendered && !this.frustumChangedThisFrame) continue

      toEvict.push(slot.chunkIndex)
    }
    for (const chunkIndex of toEvict) {
      this.releaseSlot(chunkIndex)
      // Always notify the engine so it clears the chunk from its decoded set.
      // Skipping this for "never rendered" chunks (old behaviour) left them
      // orphaned: not in the ring buffer but still marked decoded, so the engine
      // never re-fetched them when the camera returned.
      this.chunkEvictedCallback?.(chunkIndex)
    }
  }

  // --- Resize / viewport handling ------------------------------------------

  private handleResize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.max(1, Math.floor(cssWidth  * dpr))
    const h = Math.max(1, Math.floor(cssHeight * dpr))
    if (w === this.viewportPixels.w && h === this.viewportPixels.h) return

    this.viewportPixels = { w, h }
    this.ctx.canvas.width  = w
    this.ctx.canvas.height = h

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    // Recreate viewport-sized buffers.
    if (this.depthBuffer) this.depthBuffer.destroy()
    if (this.colorBuffer) this.colorBuffer.destroy()

    const pixelCount = w * h
    const sizeBytes  = pixelCount * 4

    this.depthBuffer = this.device.createBuffer({
      label: 'lazstream/depth',
      // COPY_SRC added for T1 picking (copyBufferToBuffer to staging buffer)
      size: sizeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    this.colorBuffer = this.device.createBuffer({
      label: 'lazstream/color',
      size: sizeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Recreate pick buffer at new viewport size (or keep stub if picking inactive)
    if (this.pickBuffer) this.pickBuffer.destroy()
    this.pickBuffer = this.device.createBuffer({
      label: 'lazstream/pick',
      size: this.pickEnabled ? sizeBytes : PICK_STUB_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })

    this.rebuildBindGroups()
    this.writeViewportUniform()
    this.needsRender = true
  }

  private rebuildBindGroups(): void {
    this.clearBindGroup = this.device.createBindGroup({
      label: 'lazstream/clear-bg',
      layout: this.clearBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.depthBuffer } },
        { binding: 1, resource: { buffer: this.pickBuffer } },
      ],
    })

    this.depthBindGroup = this.device.createBindGroup({
      label: 'lazstream/depth-bg',
      layout: this.depthBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniform } },
        { binding: 1, resource: { buffer: this.chunkUniform } },
        { binding: 2, resource: { buffer: this.ringBuffer } },
        { binding: 3, resource: { buffer: this.depthBuffer } },
        { binding: 4, resource: { buffer: this.colorBuffer } },
        { binding: 5, resource: { buffer: this.visibleSlotListBuf } },
        { binding: 6, resource: { buffer: this.pickBuffer } },
        { binding: 7, resource: { buffer: this.colorParamsBuffer } },
        { binding: 8, resource: { buffer: this.classLutBuffer } },
      ],
    })

    this.resolveBindGroup = this.device.createBindGroup({
      label: 'lazstream/resolve-bg',
      layout: this.resolveBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewportUniform } },
        { binding: 1, resource: { buffer: this.depthBuffer } },
        { binding: 2, resource: { buffer: this.colorBuffer } },
      ],
    })
  }

  private writeViewportUniform(): void {
    const buf = new ArrayBuffer(VIEWPORT_UNIFORM_BYTES)
    const dv = new DataView(buf)
    dv.setFloat32(0,  this.viewportPixels.w, true)
    dv.setFloat32(4,  this.viewportPixels.h, true)
    dv.setFloat32(8,  this.edlStrength,      true)
    dv.setFloat32(12, this.edlRadius,        true)
    this.device.queue.writeBuffer(this.viewportUniform, 0, buf)
  }

  private writeCameraUniform(): void {
    // Recompute viewProj = projectionMatrix × matrixWorldInverse
    this.camera.updateMatrixWorld()
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)

    let frustumChanged = false
    const el = this.viewProj.elements
    for (let i = 0; i < 16; i++) {
      if (el[i] !== this.lastViewProjElements[i]) {
        frustumChanged = true
        this.lastViewProjElements.set(el)
        break
      }
    }
    this.frustumChangedThisFrame = frustumChanged

    const v = this.cameraUniformView
    // mat4x4<f32> at offset 0..63 (16 floats, column-major — Three.js native)
    v.set(this.viewProj.elements, 0)
    // viewportSize: vec2<f32> at offset 64..71
    v[16] = this.viewportPixels.w
    v[17] = this.viewportPixels.h
    // pad at 18, 19
    v[18] = 0; v[19] = 0
    // sceneCenter: vec3<f32> at offset 80..91
    v[20] = this.sceneCenter.x
    v[21] = this.sceneCenter.y
    v[22] = this.sceneCenter.z
    v[23] = this.splatRadius

    this.device.queue.writeBuffer(this.cameraUniform, 0, v.buffer, v.byteOffset, v.byteLength)
  }

  // --- Frame loop -----------------------------------------------------------

  private renderFrame = (): void => {
    if (this.disposed) return
    this.rafHandle = requestAnimationFrame(this.renderFrame)
    this.currentFrame++

    // controls.update() drives damping animation; it fires the 'change' event
    // (which sets needsRender) for as long as damping is still settling.
    this.controls.update()

    // Skip all GPU work when nothing has changed and no chunks are waiting.
    if (!this.needsRender && this.deferredChunks.length === 0) return
    this.needsRender = false

    this.writeCameraUniform()

    const encoder = this.device.createCommandEncoder({ label: `lazstream/frame-${this.currentFrame}` })

    // --- Clear depth buffer to 0xFFFFFFFF ---
    {
      const pass = encoder.beginComputePass({ label: 'clear-depth' })
      pass.setPipeline(this.clearPipeline)
      pass.setBindGroup(0, this.clearBindGroup)
      const pixelCount = this.viewportPixels.w * this.viewportPixels.h
      pass.dispatchWorkgroups(Math.ceil(pixelCount / CLEAR_WORKGROUP_SIZE))
      pass.end()
    }

    // --- Compute pass: project + atomicMin per slot ---
    {
      const pass = encoder.beginComputePass({ label: 'points-depth' })
      pass.setPipeline(this.depthPipeline)

      // CPU-side frustum cull (6-plane vs AABB). Skip dispatch AND touch
      // for chunks whose AABB doesn't intersect the actual frustum.
      // Without this, every loaded slot is touched every frame regardless
      // of visibility → LRU eviction impossible → engine back-pressure
      // sees zero free slots forever → no streaming progress on camera
      // movement.
      //
      // Earlier attempt used frustum-AABB vs slot-AABB, which is too
      // loose: with CAMERA_FAR=100 km and 60° FOV, the enclosing AABB
      // is ~115 km wide and contains every chunk in the file. The proper
      // plane-vs-box test from THREE.Frustum handles this correctly —
      // it walks the 6 frustum planes and rejects an AABB only when all
      // 8 corners are on the negative side of any single plane.
      //
      // viewProj already operates in scene-local coords (the shader
      // applies it to worldPos - sceneCenter), so the extracted planes
      // are scene-local. We convert each slot's world AABB to scene-local
      // before testing.
      this.cullFrustum.setFromProjectionMatrix(this.viewProj)
      const cx = this.sceneCenter.x
      const cy = this.sceneCenter.y
      const cz = this.sceneCenter.z

      // Build visible slot list on CPU (same AABB cull as before), then
      // issue a single 2D dispatch instead of N setBindGroup+dispatch calls.
      let visibleCount = 0
      let maxPointCount = 0

      for (const slot of this.slots.getSlots()) {
        if (slot.pointCount === 0) continue

        // Slot AABB in scene-local coords (slot.min/range are world).
        this.cullSlotBox.min.set(
          slot.min[0] - cx,
          slot.min[1] - cy,
          slot.min[2] - cz,
        )
        this.cullSlotBox.max.set(
          slot.min[0] - cx + slot.range[0],
          slot.min[1] - cy + slot.range[1],
          slot.min[2] - cz + slot.range[2],
        )
        if (!this.cullFrustum.intersectsBox(this.cullSlotBox)) continue

        const uniformIdx = this.chunkToUniformIdx.get(slot.chunkIndex)
        if (uniformIdx === undefined) continue // shouldn't happen
        this.visibleSlotListScratch[visibleCount++] = uniformIdx
        if (slot.pointCount > maxPointCount) maxPointCount = slot.pointCount
        // Touch for LRU bookkeeping — this slot was rendered this frame.
        this.slots.touch(slot.chunkIndex, this.currentFrame)
      }

      if (visibleCount > 0) {
        this.device.queue.writeBuffer(
          this.visibleSlotListBuf, 0,
          this.visibleSlotListScratch.buffer, 0, visibleCount * 4,
        )
        const maxWG = Math.ceil(maxPointCount / COMPUTE_WORKGROUP_SIZE)
        pass.setBindGroup(0, this.depthBindGroup)
        pass.dispatchWorkgroups(maxWG, visibleCount, 1)
      }
      pass.end()
    }

    // Proactively free slots that have been invisible for EVICT_GRACE_FRAMES.
    // Runs every frame (past the needsRender idle-skip). The internal threshold
    // in evictInvisibleSlots() is the correct guard — the outer lastCameraMovedFrame
    // guard was causing chunks that go off-screen to never be evicted and thus
    // never re-requested when the camera returns.
    this.evictInvisibleSlots()

    // Retry any chunks that arrived from decode but couldn't fit at the time —
    // the compute pass just updated lastRenderedFrame for visible slots, so any
    // slot NOT touched this frame is now LRU-evictable. Allocates them in,
    // evicting stale slots in the process. Cheap when queue is empty.
    this.flushDeferredChunks()

    // --- Resolve pass: fullscreen triangle to canvas texture ---
    {
      const view = this.ctx.context.getCurrentTexture().createView()
      const pass = encoder.beginRenderPass({
        label: 'resolve',
        colorAttachments: [{
          view,
          loadOp:  'clear',
          storeOp: 'store',
          clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 },
        }],
      })
      pass.setPipeline(this.resolvePipeline)
      pass.setBindGroup(0, this.resolveBindGroup)
      pass.draw(3)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])

    if (this.onFrame) {
      this.onFrame({
        frame: this.currentFrame,
        slots: this.slots.getSlots().length,
        pointsLoaded: this.slots.pointsLoaded(),
      })
    }
  }
}