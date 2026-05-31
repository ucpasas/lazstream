/**
 * URL validation and sanitisation
 * Security layer for user-supplied LAZ URLs and manifest URLs.
 */

export class SecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecurityError'
  }
}

// Private/reserved IP ranges that should never be fetched
const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,         // Link-local
  /^0\.0\.0\.0$/,        // Unspecified (routes to localhost on many OSes)
  /^::1$/,               // IPv6 loopback
  /^::$/,                // IPv6 unspecified
  /^fc00:/,              // IPv6 unique local
  /^fe80:/,              // IPv6 link-local
  /^::ffff:10\./,        // IPv4-mapped RFC-1918 class A
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,  // IPv4-mapped RFC-1918 class B
  /^::ffff:192\.168\./,  // IPv4-mapped RFC-1918 class C
  /^::ffff:127\./,       // IPv4-mapped loopback
  /^::ffff:169\.254\./,  // IPv4-mapped link-local
]

function isPrivateIP(hostname: string): boolean {
  return PRIVATE_RANGES.some(r => r.test(hostname))
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' ||
         hostname === '127.0.0.1' ||
         hostname === '::1'
}

/**
 * Core URL validation: scheme whitelist + private IP block.
 * The extension check is applied by the public wrapper functions.
 */
function validateUrl(raw: string, endsWith: string, label: string): URL {
  const trimmed = raw.trim()

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SecurityError(`Invalid URL: "${trimmed}"`)
  }

  const allowedSchemes = ['https:']
  if (isLocalhost(url.hostname)) allowedSchemes.push('http:')

  if (!allowedSchemes.includes(url.protocol)) {
    throw new SecurityError(
      `Blocked URL scheme "${url.protocol}". Only HTTPS URLs are supported.`
    )
  }

  if (isPrivateIP(url.hostname) && !isLocalhost(url.hostname)) {
    throw new SecurityError(
      `Blocked private IP address "${url.hostname}".`
    )
  }

  if (!url.pathname.toLowerCase().endsWith(endsWith)) {
    throw new SecurityError(
      `URL does not point to ${label}. Expected a path ending in "${endsWith}".`
    )
  }

  return url
}

/**
 * Validates and returns a safe URL object for a user-supplied LAZ file.
 * Throws SecurityError for blocked schemes, private IPs, or malformed URLs.
 */
export function validateSourceUrl(raw: string): URL {
  return validateUrl(raw, '.laz', 'a LAZ file')
}

/**
 * Validates and returns a safe URL object for a .lazm.json manifest file.
 * Applies the same scheme and IP rules as validateSourceUrl.
 */
export function validateManifestUrl(raw: string): URL {
  return validateUrl(raw, '.lazm.json', 'a manifest file')
}

// ─── URL parameter helpers ────────────────────────────────────────────────────

export type EntryParam =
  | { type: 'laz';      url: string }
  | { type: 'manifest'; url: string }

/**
 * Read the viewer entry point from URL query parameters.
 *
 * Priority:
 *   ?manifest= — .lazm.json manifest URL (takes precedence)
 *   ?url=      — direct .laz file URL
 *
 * Returns null if neither parameter is present.
 * Does NOT validate the URL — call validateSourceUrl / validateManifestUrl first.
 */
export function getEntryFromParams(): EntryParam | null {
  const params = new URLSearchParams(window.location.search)
  const manifest = params.get('manifest')
  if (manifest) return { type: 'manifest', url: manifest }
  const laz = params.get('url')
  if (laz) return { type: 'laz', url: laz }
  return null
}

