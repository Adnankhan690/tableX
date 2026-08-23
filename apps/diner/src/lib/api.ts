import { DinerApi } from '@tablex/api-client'
import { env } from './env'

/**
 * The single DinerApi instance for the whole app.
 *
 * One instance rather than one per component, for two reasons that matter beyond tidiness:
 * the client owns the request timeout and the envelope-unwrapping rules, so a second
 * instance built with different arguments would produce a screen that behaves differently
 * from the rest of the app for no visible reason. And because it is stateless -- the guest
 * token is passed per call rather than held -- sharing it is safe even while a diner rescans
 * a different table mid-visit and their token changes underneath.
 */
export const api = new DinerApi({ baseUrl: env.apiBaseUrl })

/**
 * Builds the WebSocket URL for one order's live feed (docs/DECISIONS.md D10).
 *
 * The token goes in the query string because a browser `WebSocket` cannot set request
 * headers -- there is no API for it. That is a real downside, since URLs land in proxy logs
 * more readily than headers do, and it is why the backend's request logger deliberately
 * omits query strings.
 */
export function orderStreamUrl(orderUid: string, token: string): string {
  const url = new URL(`${env.wsBaseUrl}/api/guest/v1/orders/${encodeURIComponent(orderUid)}/stream`)
  url.searchParams.set('token', token)
  return url.toString()
}
