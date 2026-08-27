/**
 * Where the new-order sound preference lives.
 *
 * Extracted into its own module because the CONTROL and the SOUND are now on different pages: the
 * toggle is a row on Settings, the chime plays on the order board. They coordinate through this
 * key rather than through React, since there is no common ancestor to hold the state and a context
 * spanning the whole panel for one boolean would be a lot of wiring for a device preference.
 *
 * Per-device, not per-restaurant, and that distinction is the reason it is localStorage rather than
 * a column on the settings table: which tablet wants sound is a property of where it sits in the
 * building. The kitchen screen wants it; the manager's laptop in the back office does not, and one
 * of them turning it off must not silence the other.
 *
 * `.v1` follows the convention in lib/auth.ts -- a future shape change reads a new key and gets the
 * default rather than misreading this one.
 *
 * STORED INVERTED ('0' means enabled) because the key is named for the muted state and predates the
 * toggle moving to Settings. Left as-is deliberately: renaming it would silently reset the
 * preference on every device that has already set it.
 */
const MUTE_KEY = 'tablex.admin.chime-muted.v1'

/**
 * Guarded twice, as everywhere else that touches storage in this panel: `typeof window` for server
 * rendering, try/catch because Safari private mode and blocked-site-data settings make localStorage
 * *throw* rather than return null.
 *
 * MUST NOT be called during render or in a `useState` initialiser -- the server markup and the
 * first client render would disagree and React reports that as a hydration error. Read it in an
 * effect and let the first paint show the default.
 */
export function readChimeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MUTE_KEY) === '0'
  } catch {
    // Off is the honest default: a page that makes noise without being asked is a page people mute
    // at the operating system and never hear again.
    return false
  }
}

export function writeChimeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MUTE_KEY, enabled ? '0' : '1')
  } catch {
    /* Denied or over quota. It still takes effect for this page load; it is a preference, not data. */
  }
}
