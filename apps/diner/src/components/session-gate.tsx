'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useSession } from '@/components/providers'
import { CenteredMessage } from '@/components/screen'
import type { GuestSession } from '@/lib/session'

const GatedSessionContext = createContext<GuestSession | null>(null)

/**
 * Renders children only when there is a usable session, and publishes that session to them.
 *
 * The session is passed by context rather than as a render prop, and that is not a style
 * choice: the route files above are server components, and a function prop cannot cross the
 * server-to-client boundary -- Next fails the build with "Functions cannot be passed directly
 * to Client Components". Context keeps the route files as thin server components while the
 * screens below stay client-side.
 *
 * The other job here is encapsulating the hydration rule. `session` is null on the first
 * render even for a diner who has one, because localStorage is only readable in an effect. Any
 * screen deciding on `!session` alone would bounce every returning diner to "scan again", so
 * that decision lives here once.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { session, hydrated, expired } = useSession()

  // Nothing, not a spinner. Hydration resolves within a frame, and a spinner that appears and
  // vanishes reads as a flicker rather than as progress.
  if (!hydrated) return null

  if (session === null) {
    return (
      <CenteredMessage
        title="Scan to order"
        body="Point your phone camera at the QR code on your table to start."
      />
    )
  }

  if (expired) {
    return (
      <CenteredMessage
        title="Your ordering session has ended"
        // The table label is still known, which makes this concrete rather than generic.
        body={`Please scan the QR code on Table ${session.tableLabel} again to keep ordering.`}
      />
    )
  }

  return <GatedSessionContext.Provider value={session}>{children}</GatedSessionContext.Provider>
}

/**
 * The session, guaranteed present.
 *
 * Safe to return non-null because SessionGate renders its children only once it has one. The
 * throw is for the case that guarantee is broken by someone rendering a screen outside the
 * gate -- a loud failure in development beats a screen that silently sends unauthenticated
 * requests.
 */
export function useGatedSession(): GuestSession {
  const session = useContext(GatedSessionContext)
  if (session === null) {
    throw new Error('useGatedSession must be used inside <SessionGate>')
  }
  return session
}
