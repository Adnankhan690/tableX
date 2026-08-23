import { AdminApi } from '@tablex/api-client'
import { env } from './env'

/** One shared instance. Stateless -- the token is passed per call, never held. */
export const api = new AdminApi({ baseUrl: env.apiBaseUrl })

/**
 * The staff order feed's WebSocket URL (docs/DECISIONS.md D10).
 *
 * The token travels in the query string because a browser `WebSocket` cannot set an
 * Authorization header. That is why the backend's request logger omits query strings.
 */
export function adminStreamUrl(token: string): string {
  const url = new URL(`${env.wsBaseUrl}/api/admin/v1/stream`)
  url.searchParams.set('token', token)
  return url.toString()
}
