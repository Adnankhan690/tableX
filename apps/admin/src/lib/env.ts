/**
 * Build-time configuration. Both values are NEXT_PUBLIC_, so Next inlines them into the
 * browser bundle -- which means `process.env.NEXT_PUBLIC_X` must be a literal member access
 * rather than a dynamic lookup, since the inlining is a textual substitution.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8080'
const DEFAULT_WS_BASE_URL = 'ws://localhost:8080'

export interface AdminEnv {
  readonly apiBaseUrl: string
  readonly wsBaseUrl: string
}

/**
 * An absent value falls back to localhost; a present but malformed one throws. A bad deploy
 * should fail loudly at load rather than have every request quietly 404 against a subtly wrong
 * host, which gets diagnosed as "the backend is down".
 */
function parseBaseUrl(
  name: string,
  raw: string | undefined,
  fallback: string,
  allowedProtocols: readonly string[],
): string {
  const value = raw?.trim()
  if (!value) return fallback

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a valid absolute URL: ${JSON.stringify(value)}`)
  }
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`${name} must use one of ${allowedProtocols.join(', ')} -- got ${url.protocol}`)
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

export const env: AdminEnv = {
  apiBaseUrl: parseBaseUrl(
    'NEXT_PUBLIC_API_BASE_URL',
    process.env.NEXT_PUBLIC_API_BASE_URL,
    DEFAULT_API_BASE_URL,
    ['http:', 'https:'],
  ),
  wsBaseUrl: parseBaseUrl(
    'NEXT_PUBLIC_WS_BASE_URL',
    process.env.NEXT_PUBLIC_WS_BASE_URL,
    DEFAULT_WS_BASE_URL,
    // http/https are rejected rather than coerced: a socket opened against an http URL fails
    // with a message that points nowhere near this config.
    ['ws:', 'wss:'],
  ),
}
