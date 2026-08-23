import type { ScanTableResponse } from '@tablex/shared'

/**
 * Guest session persistence (docs/DECISIONS.md D5).
 *
 * The diner has no account. Their identity for the whole sitting is one opaque token held
 * in localStorage, and losing it means losing the order-tracking screen they were promised,
 * so this module's job is to hold onto it without ever throwing.
 */
export interface GuestSession {
  /** The opaque guest token, sent as X-Guest-Token on every call. */
  token: string
  /** ISO timestamp; the server issues 12-hour sessions (docs/DECISIONS.md D5). */
  expiresAt: string
  tableLabel: string
  tableUid: string
  restaurantName: string
  restaurantSlug: string
}

/**
 * The `.v1` suffix is the whole point of this constant.
 *
 * A diner's browser can hold a session written by a build from months ago. When this shape
 * changes, the new build reads under `.v2` and simply finds nothing -- the stale object is
 * ignored rather than parsed into a half-populated session that crashes on a field that no
 * longer exists. Bumping the suffix is the migration; there is no migration code.
 */
const SESSION_KEY = 'tablex.session.v1'

// --- localStorage access ---
//
// Every read and write is guarded twice. `typeof window` covers server rendering, where
// there is no storage at all. The try/catch covers Safari private mode and Chrome's
// "block third-party cookies" setting, both of which make localStorage *throw* rather than
// return null -- and a diner in private browsing must still be able to order, so a throw
// here can never be allowed to reach a render.
//
// Exported because cart.ts needs the identical guarantee: two copies of this would drift,
// and the failure they prevent (a throw on a quantity tap) is invisible in normal testing.

export function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Storage denied. Treated as "nothing stored" so the app degrades to a single-page-load
    // session rather than failing.
    return null
  }
}

export function writeStored(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Denied or over quota. The in-memory React state still holds the session, so the diner
    // can complete their order; they lose it only if they reload.
  }
}

export function removeStored(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to do -- if storage is unreadable it is also unwritable, so there is no stale
    // value to worry about.
  }
}

// --- Session ---

/**
 * Structural validation of whatever was in storage.
 *
 * The value is attacker-controlled in the sense that anything can write to localStorage, and
 * it is version-controlled only by convention, so it is treated as untrusted input rather
 * than cast. Written with `in` narrowing instead of a cast so no assertion hides a missing
 * field.
 */
function isGuestSession(value: unknown): value is GuestSession {
  if (typeof value !== 'object' || value === null) return false

  return (
    'token' in value &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string' &&
    'tableLabel' in value &&
    typeof value.tableLabel === 'string' &&
    'tableUid' in value &&
    typeof value.tableUid === 'string' &&
    'restaurantName' in value &&
    typeof value.restaurantName === 'string' &&
    'restaurantSlug' in value &&
    typeof value.restaurantSlug === 'string'
  )
}

/**
 * Returns the stored session, or null if there is none or it is unusable.
 *
 * Deliberately does NOT filter out expired sessions -- callers combine this with
 * `isExpired` so that an expired session can still be used for its table label ("Your
 * session at Table 4 has ended") instead of dropping the diner onto an anonymous screen.
 */
export function readSession(): GuestSession | null {
  const raw = readStored(SESSION_KEY)
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearSession()
    return null
  }

  if (!isGuestSession(parsed)) {
    // Unparseable under the current shape. Remove it rather than leaving it to fail the same
    // check on every page load.
    clearSession()
    return null
  }

  return parsed
}

export function writeSession(session: GuestSession): void {
  writeStored(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  removeStored(SESSION_KEY)
}

/**
 * Whether the stored session is past its expiry.
 *
 * A client-side hint only, and it must be treated as one: the diner's phone clock can be
 * wrong by hours. The authority is the server, which answers a dead token with a `TX_SES_*`
 * error (`ApiError.isSessionError`) -- so callers should handle that regardless of what this
 * returns rather than trusting the local clock. No skew allowance is applied, because
 * guessing at the size of the skew is not better than checking the real answer.
 *
 * An unparseable timestamp counts as expired: the alternative keeps a diner on a session
 * every request will reject.
 */
export function isExpired(session: GuestSession, now: number = Date.now()): boolean {
  const expiry = Date.parse(session.expiresAt)
  if (Number.isNaN(expiry)) return true
  return expiry <= now
}

/**
 * Builds the stored session from a scan response.
 *
 * Lives here so the scan route and this module cannot disagree about which field of
 * `ScanTableResponse` maps to which stored key -- getting `table.uid` and `session.uid`
 * the wrong way round is a bug that would only surface as an empty cart later.
 */
export function sessionFromScan(scan: ScanTableResponse): GuestSession {
  return {
    token: scan.session.token,
    expiresAt: scan.session.expires_at,
    tableLabel: scan.table.label,
    tableUid: scan.table.uid,
    restaurantName: scan.menu.restaurant.name,
    restaurantSlug: scan.menu.restaurant.slug,
  }
}
