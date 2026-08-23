import { CODE_SUCCESS, type Envelope } from '@tablex/shared'
import { errorFromEnvelope, NetworkError } from './errors'

/** How a request authenticates. */
export type AuthMode =
  /** No credentials: the public scan and webhook routes. */
  | { kind: 'none' }
  /** The diner's opaque session token, sent as X-Guest-Token (docs/DECISIONS.md D5). */
  | { kind: 'guest'; token: string }
  /** A staff JWT, sent as a bearer token. */
  | { kind: 'staff'; token: string }

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Serialised as JSON. Omit for GET. */
  body?: unknown
  /** Appended as a query string. Undefined and null values are dropped; arrays repeat the key. */
  query?: Record<string, string | number | boolean | undefined | null | string[]>
  auth?: AuthMode
  /**
   * Sent as the Idempotency-Key header. Set it on order placement so a double-tap on a
   * stalled connection cannot produce two kitchen tickets (docs/DECISIONS.md D12).
   */
  idempotencyKey?: string
  signal?: AbortSignal
  /** Per-request override of the client's default timeout. */
  timeoutMs?: number
}

export interface HttpClientConfig {
  baseUrl: string
  /**
   * Default request timeout.
   *
   * A timeout is mandatory, not optional: `fetch` has none, so a hung server would leave a
   * diner's checkout button spinning forever with no way back. 15s is long enough for a
   * slow 3G round trip and short enough to fail before the diner gives up.
   */
  timeoutMs?: number
  /** Called on any 401 so the app can clear stored credentials and redirect. */
  onUnauthorized?: () => void
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * The single HTTP client both apps use.
 *
 * It exists so that envelope unwrapping, error mapping, timeouts and auth headers are
 * decided once. Every call in either app goes through `request`, which is what makes
 * "handle a 401 everywhere" a one-line change rather than an audit.
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly onUnauthorized?: () => void

  constructor(config: HttpClientConfig) {
    // Trailing slashes are stripped so callers can pass paths with or without a leading
    // slash without producing a double one.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.onUnauthorized = config.onUnauthorized
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query)
    const headers = this.buildHeaders(options)

    // The client's own timeout is combined with any caller-supplied signal, so a component
    // unmounting still aborts an in-flight request that has not yet timed out.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
    } catch (cause) {
      throw new NetworkError(cause)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }

    return this.unwrap<T>(response)
  }

  private async unwrap<T>(response: Response): Promise<T> {
    // A 204 has no body to parse. Reading one would throw on the empty string.
    if (response.status === 204) return undefined as T

    let envelope: Envelope<T> | null = null
    try {
      envelope = (await response.json()) as Envelope<T>
    } catch {
      // A body that is not JSON means something in front of the API answered -- a proxy
      // error page, typically. Fall through to the status-based error rather than crashing
      // on the parse, which would hide the real status from the caller.
      envelope = null
    }

    if (!response.ok) {
      const error = errorFromEnvelope(response.status, envelope)
      if (error.isAuthError) this.onUnauthorized?.()
      throw error
    }

    // A 2xx carrying a non-success code should not happen, but treating it as success would
    // hand the caller an empty object typed as data.
    if (envelope && envelope.code !== CODE_SUCCESS) {
      throw errorFromEnvelope(response.status, envelope)
    }

    return (envelope?.data ?? (undefined as T)) as T
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalised = path.startsWith('/') ? path : `/${path}`
    const url = new URL(this.baseUrl + normalised)

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue
      // Arrays repeat the key (?status=placed&status=accepted), which is what gin's
      // ShouldBindQuery expects for a []string field.
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item)
      } else {
        url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  }

  private buildHeaders(options: RequestOptions): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/json' }

    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    const auth = options.auth ?? { kind: 'none' as const }
    if (auth.kind === 'guest') {
      headers['X-Guest-Token'] = auth.token
    } else if (auth.kind === 'staff') {
      headers.Authorization = `Bearer ${auth.token}`
    }

    return headers
  }
}

/**
 * Generates an idempotency key for a checkout attempt.
 *
 * Must be generated once when the diner opens the cart and reused across retries of that
 * same order -- generating a fresh one per attempt would defeat the entire mechanism, since
 * each retry would look like a new order to the server.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for older WebViews, which some in-app QR scanners still use.
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
