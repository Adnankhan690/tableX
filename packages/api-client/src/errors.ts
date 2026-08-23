import type { Envelope } from '@tablex/shared'

/**
 * A failed API call.
 *
 * `code` is the stable machine-readable identifier (`TX_ORD_006`), and it is what callers
 * should branch on -- never the message. Messages are human copy and will be translated to
 * Hindi (PRD 7); branching on them would make the app's behaviour depend on its language.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly details?: Record<string, string>

  constructor(args: {
    code: string
    message: string
    status: number
    requestId?: string
    details?: Record<string, string>
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.code = args.code
    this.status = args.status
    this.requestId = args.requestId
    this.details = args.details
  }

  /**
   * True when retrying the identical request could plausibly succeed.
   *
   * Deliberately excludes 409: a conflict means the world moved on (the order was already
   * accepted), so the fix is to refetch and re-decide, not to retry the same call.
   */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }

  /** True when the caller's credentials are the problem. */
  get isAuthError(): boolean {
    return this.status === 401
  }

  /** True when the diner's guest session needs re-establishing by rescanning the QR. */
  get isSessionError(): boolean {
    return this.code.startsWith('TX_SES_')
  }

  /**
   * True when the order moved on underneath us -- two staff tapped Accept, or the diner's
   * cancel raced the kitchen's accept (docs/DECISIONS.md D1, D6). The correct response is
   * always to refetch, never to show a validation error.
   */
  get isStale(): boolean {
    return this.status === 409
  }
}

/** The error raised when the network never produced a response at all. */
export class NetworkError extends ApiError {
  constructor(cause: unknown) {
    super({
      code: 'TX_NET_000',
      // Phrased for a diner on restaurant wifi, which is the common case, rather than as a
      // technical description of a fetch rejection.
      message: 'Could not reach the server. Check your connection and try again.',
      status: 0,
    })
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/** Narrows an unknown error, for use in catch blocks. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** Builds an ApiError from a non-2xx envelope. */
export function errorFromEnvelope(status: number, body: Envelope<unknown> | null): ApiError {
  const details =
    body?.data && typeof body.data === 'object' && 'details' in body.data
      ? ((body.data as { details?: Record<string, string> }).details ?? undefined)
      : undefined

  return new ApiError({
    code: body?.code ?? `TX_HTTP_${status}`,
    message: body?.message ?? `Request failed with status ${status}`,
    status,
    requestId: body?.request_id,
    details,
  })
}
