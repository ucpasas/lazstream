/**
 * View state encode/decode for shareable URLs.
 *
 * Encodes a LAZ source URL + camera position into a compact base64url token
 * suitable for embedding in the URL fragment (#v=<token>). The fragment is
 * never sent to any server — purely client-side.
 */

export interface CameraState {
  /** Camera position in world space (same units as point cloud). */
  x: number; y: number; z: number
  /** OrbitControls look-at target in world space. */
  tx: number; ty: number; tz: number
  /** Vertical field of view in radians. */
  fovY: number
}

export interface ViewState {
  /** Bare .laz URL or .lazm.json manifest URL. */
  source: string
  cam: CameraState
}

export class ViewStateDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViewStateDecodeError'
  }
}

export function encodeViewState(state: ViewState): string {
  const json = JSON.stringify(state)
  const bytes = new TextEncoder().encode(json)
  // base64url (RFC 4648 §5) — no padding, URL-safe chars
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeViewState(token: string): ViewState {
  let json: string
  try {
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/')
    json = atob(base64)
  } catch {
    throw new ViewStateDecodeError('Invalid base64url in #v= token')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ViewStateDecodeError('Decoded #v= token is not valid JSON')
  }

  validateViewState(parsed)
  return parsed as ViewState
}

function validateViewState(raw: unknown): asserts raw is ViewState {
  if (typeof raw !== 'object' || raw === null) {
    throw new ViewStateDecodeError('View state must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj['source'] !== 'string' || obj['source'].trim() === '') {
    throw new ViewStateDecodeError('View state "source" must be a non-empty string')
  }

  const cam = obj['cam']
  if (typeof cam !== 'object' || cam === null) {
    throw new ViewStateDecodeError('View state "cam" must be an object')
  }
  const c = cam as Record<string, unknown>
  const fields: (keyof CameraState)[] = ['x', 'y', 'z', 'tx', 'ty', 'tz', 'fovY']
  for (const f of fields) {
    if (typeof c[f] !== 'number' || !Number.isFinite(c[f] as number)) {
      throw new ViewStateDecodeError(`View state cam.${f} must be a finite number`)
    }
  }
}
