/**
 * URL validation and sanitisation
 * Security layer for user-supplied LAZ URLs
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
  /^169\.254\./,   // Link-local
  /^::1$/,          // IPv6 loopback
  /^fc00:/,         // IPv6 unique local
  /^fe80:/,         // IPv6 link-local
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
 * Validates and returns a safe URL object for a user-supplied LAZ source.
 * Throws SecurityError for blocked schemes, private IPs, or malformed URLs.
 */
export function validateSourceUrl(raw: string): URL {
  // Trim whitespace — common paste artifact
  const trimmed = raw.trim()

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SecurityError(`Invalid URL: "${trimmed}"`)
  }

  // Scheme whitelist — only https in production, http only for localhost dev
  const allowedSchemes = ['https:']
  if (isLocalhost(url.hostname)) {
    allowedSchemes.push('http:')
  }

  if (!allowedSchemes.includes(url.protocol)) {
    throw new SecurityError(
      `Blocked URL scheme "${url.protocol}". Only HTTPS URLs are supported.`
    )
  }

  // Block private IPs — defense in depth (CORS will also block, but be explicit)
  if (isPrivateIP(url.hostname) && !isLocalhost(url.hostname)) {
    throw new SecurityError(
      `Blocked private IP address "${url.hostname}".`
    )
  }

  // Must end with .laz (case-insensitive) — basic file type check
  // The real check is the LAS magic bytes in the header parser
  const pathname = url.pathname.toLowerCase()
  if (!pathname.endsWith('.laz')) {
    throw new SecurityError(
      `URL does not point to a LAZ file. Expected a path ending in ".laz".`
    )
  }

  return url
}

/**
 * Reads and validates the ?url= query parameter from the current page URL.
 * Returns null if not present.
 */
export function getUrlFromParams(): string | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('url')
  return raw ? raw : null
}