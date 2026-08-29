/**
 * Build-time configuration for the diner app.
 *
 * Every value here is NEXT_PUBLIC_, so Next inlines it into the browser bundle at build
 * time. Two consequences worth knowing before editing this file:
 *
 *  1. `process.env.NEXT_PUBLIC_X` must be written as a literal member access. Next's
 *     inlining is a textual substitution, so `process.env[name]` in a loop reads an empty
 *     object in the browser -- which is why the two reads below are spelled out rather than
 *     factored into a table.
 *  2. Validation runs when this module is first evaluated, which in practice is on the
 *     diner's first page load. That is deliberate: a malformed base URL should break loudly
 *     and immediately, because the alternative is every request 404ing against a subtly
 *     wrong host and the bug being diagnosed as "the backend is down".
 */

/** Localhost defaults so a fresh clone runs with no .env file at all. */
const DEFAULT_API_BASE_URL = 'http://localhost:8080'
const DEFAULT_WS_BASE_URL = 'ws://localhost:8080'

export interface DinerEnv {
  /** Origin of the REST API, no trailing slash. */
  readonly apiBaseUrl: string
  /** Origin of the realtime endpoint, no trailing slash (docs/DECISIONS.md D10). */
  readonly wsBaseUrl: string
}

/**
 * Validates one base URL, or throws.
 *
 * An absent value falls back to localhost; a *present but malformed* value is a bad deploy
 * and is never silently replaced by the default, because that would leave a production build
 * quietly pointing at a host that does not exist.
 *
 * Exported for `lib/site.ts`, which validates the public site and admin origins on exactly the
 * same terms. A second copy there would drift, and the drift would be invisible: both copies
 * only ever run on a misconfigured deploy.
 */
export function parseBaseUrl(
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
    throw new Error(
      `${name} must use one of ${allowedProtocols.join(', ')} -- got ${url.protocol} in ${value}`,
    )
  }

  // A query string or fragment on a base URL is always a paste error, and it would survive
  // silently into every request path.
  if (url.search !== '' || url.hash !== '') {
    throw new Error(`${name} must not carry a query string or fragment: ${value}`)
  }

  // Trailing slashes are stripped here so callers can concatenate a leading-slash path
  // without producing a double slash. HttpClient does the same to its own baseUrl; matching
  // it means the two agree on what the origin is.
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

export const env: DinerEnv = {
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
    // http/https are rejected rather than coerced: a WebSocket opened against an http URL
    // fails at connect time with a message that points nowhere near the config.
    ['ws:', 'wss:'],
  ),
}
