import type { RestaurantSummary, StaffMember } from '@tablex/shared'

/**
 * Staff session persistence.
 *
 * Tokens are held in localStorage, and that is a deliberate v1 trade rather than an oversight,
 * so it is worth stating plainly: localStorage is readable by any script running on this
 * origin, so an XSS bug here hands over a staff token. An httpOnly, SameSite cookie would be
 * strictly stronger.
 *
 * Why it is accepted for now: this panel is served from its own origin, separate from the
 * public diner app, and it loads no third-party script -- no analytics, no tag manager, no
 * embedded widget, no icon or chart library (see package.json). That removes the realistic
 * injection paths. The access token is also short-lived, which bounds what a stolen one is
 * worth.
 *
 * When to change it: the moment this panel embeds anything external, or serves user-supplied
 * HTML. That is the trigger, and it should not wait for an incident.
 */
export interface AdminAuth {
  accessToken: string
  refreshToken: string
  /** ISO timestamp of access-token expiry. */
  expiresAt: string
  staff: StaffMember
  restaurant: RestaurantSummary
}

/**
 * The `.v1` suffix is the migration strategy. When this shape changes, a new build reads under
 * `.v2`, finds nothing, and sends the user to the login screen -- rather than parsing a stale
 * object into a half-populated session that crashes on a missing field.
 */
const AUTH_KEY = 'tablex.admin.v1'

// Guarded twice, as in the diner app: `typeof window` for server rendering, try/catch because
// Safari private mode and blocked-site-data settings make localStorage *throw* rather than
// return null. A throw during render would take out the whole panel mid-service.

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Denied or over quota. React state still holds the session for this page load, so the
    // staff member can keep working; they are asked to sign in again after a reload.
  }
}

function remove(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* Unreadable storage is also unwritable, so there is no stale value to clear. */
  }
}

function isAdminAuth(value: unknown): value is AdminAuth {
  if (typeof value !== 'object' || value === null) return false
  return (
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string' &&
    'staff' in value &&
    typeof value.staff === 'object' &&
    value.staff !== null &&
    'restaurant' in value &&
    typeof value.restaurant === 'object' &&
    value.restaurant !== null
  )
}

export function readAuth(): AdminAuth | null {
  const raw = read(AUTH_KEY)
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isAdminAuth(parsed)) {
      clearAuth()
      return null
    }
    return parsed
  } catch {
    clearAuth()
    return null
  }
}

export function writeAuth(auth: AdminAuth): void {
  write(AUTH_KEY, JSON.stringify(auth))
}

export function clearAuth(): void {
  remove(AUTH_KEY)
}

/**
 * Whether the access token is close enough to expiry to refresh proactively.
 *
 * The skew exists so a request is not fired with a token that expires while it is in flight --
 * which would surface as a spurious 401 in the middle of accepting an order. 60 seconds is
 * comfortably longer than any request here takes.
 *
 * An unparseable timestamp counts as expiring, because the alternative is never refreshing.
 */
export function isExpiring(auth: AdminAuth, skewSeconds = 60, now: number = Date.now()): boolean {
  const expiry = Date.parse(auth.expiresAt)
  if (Number.isNaN(expiry)) return true
  return expiry - now <= skewSeconds * 1000
}
