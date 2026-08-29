'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type GuestSession, isExpired, readSession, readStored, writeStored } from '@/lib/session'
import { CloseGlyph } from './glyphs'

/**
 * "You are ordering at Table N", preserved from the old root route.
 *
 * `/` used to be `<RootLanding>`, whose whole job was this: a diner who taps Home mid-meal finds
 * their way back to the menu. Turning `/` into a marketing page must not cost them that, so the
 * affordance moved here rather than being deleted.
 *
 * Two structural notes, both load-bearing:
 *
 *  1. It imports from `@/lib/session` DIRECTLY, never from `@/components/providers`. The
 *     marketing layout mounts no <Providers>, so `useSession()` would throw here — and importing
 *     it anyway would drag SessionProvider, CartProvider and cart.ts into the bundle of the one
 *     page that is somebody's first impression of the product. The four functions used here are
 *     plain, React-free, and already double-guarded against Safari private mode, which *throws*
 *     from localStorage rather than returning null.
 *  2. It is the only client component in the marketing tree. Everything else is a server
 *     component, which is why the landing page's first-load JS is lighter than the root route it
 *     replaced.
 */

/**
 * Dismissal is keyed to the session TOKEN, not to a bare boolean.
 *
 * A permanent "dismissed" flag would delete the affordance this component exists to protect: the
 * diner who dismissed it last week would never see it again on the night it matters. Storing the
 * token means the bar returns the moment a new sitting starts, and stays gone for this one.
 */
const DISMISS_KEY = 'tablex.returnbar.dismissed.v1'

export function ReturnToTable() {
  const [session, setSession] = useState<GuestSession | null>(null)
  // Starts hidden and is only ever revealed, so the bar can never flash on a page load that
  // turns out to have no session behind it.
  const [dismissed, setDismissed] = useState(true)

  /**
   * Storage is read in an effect, never during render — the same rule providers.tsx documents.
   * "No session" and "not yet read" look identical, and rendering the guess produces different
   * HTML on the server than on the client, which React resolves by discarding the server HTML.
   */
  useEffect(() => {
    const stored = readSession()
    if (!stored || isExpired(stored)) return
    setSession(stored)
    setDismissed(readStored(DISMISS_KEY) === stored.token)
  }, [])

  if (!session || dismissed) return null

  return (
    /**
     * Deliberately the diner app's own `BottomBar` idiom — fixed, `max-w-phone`, `shadow-bar`,
     * `pb-safe` — so a returning diner reads it as their app rather than as a marketing banner.
     *
     * Bottom-fixed rather than a strip above the hero for three reasons: it renders only after
     * hydration, so a top banner would push the hero down and score a layout shift on the one
     * page that is measured for it; the bottom is where the thumb already is on the phone where
     * this matters; and it is one element at every breakpoint rather than a pair behind a
     * breakpoint. Because it is client-only by construction, a crawler never sees it.
     */
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-phone">
      <div className="flex items-center gap-3 border-t border-line bg-surface px-4 pt-3 shadow-bar pb-safe">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold leading-tight text-ink">
            {session.restaurantName}
          </p>
          <p className="truncate text-[0.8125rem] leading-tight text-muted">
            Table {session.tableLabel}
          </p>
        </div>
        {/* nofollow on every link into the diner app: those routes are noindex, and /menu behind
            a live session is not a page anyone should arrive at from a search result. */}
        <Link
          href="/menu"
          rel="nofollow"
          className="flex min-h-tap shrink-0 items-center rounded-card bg-accent px-4 text-[0.9375rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
        >
          Open the menu
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            writeStored(DISMISS_KEY, session.token)
            setDismissed(true)
          }}
          className="flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-sunken"
        >
          <CloseGlyph />
        </button>
      </div>
    </div>
  )
}
