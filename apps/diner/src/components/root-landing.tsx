'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useSession } from '@/components/providers'
import { CenteredMessage, PrimaryButton } from '@/components/screen'

/**
 * Client half of the root route: it needs localStorage to know whether the diner already has
 * a session, and that is only readable in the browser.
 */
export function RootLanding({ fallback }: { fallback?: ReactNode }) {
  const { session, hydrated, expired } = useSession()

  // Nothing is rendered before hydration finishes, because "no session" and "not yet read"
  // look identical here and guessing would flash the wrong screen.
  if (!hydrated) return null

  if (session && !expired) {
    return (
      <CenteredMessage
        title={session.restaurantName}
        body={`You are ordering at Table ${session.tableLabel}.`}
        action={
          <Link href="/menu" className="block">
            <PrimaryButton>Open the menu</PrimaryButton>
          </Link>
        }
      />
    )
  }

  return (
    <CenteredMessage
      title="Scan to order"
      body="Point your phone camera at the QR code on your table to see the menu and order."
      action={fallback ? <span className="text-sm text-muted">{fallback}</span> : undefined}
    />
  )
}
