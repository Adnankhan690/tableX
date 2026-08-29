'use client'

import { isApiError } from '@tablex/api-client'
import type { RestaurantLandingResponse } from '@tablex/shared'
import { EmptyState, Spinner } from '@tablex/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/components/providers'
import { CenteredMessage, PrimaryButton, ScreenHeader } from '@/components/screen'
import { api } from '@/lib/api'
import type { GuestSession } from '@/lib/session'
import { isExpired, readSession, sessionFromScan } from '@/lib/session'

/** The diner picks their own table, then the flow is identical to a table scan. */
export function RestaurantLanding({ slug }: { slug: string }) {
  const router = useRouter()
  const { setSession } = useSession()

  const [landing, setLanding] = useState<RestaurantLandingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .restaurantLanding(slug, controller.signal)
      .then(setLanding)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'Could not load this restaurant.')
      })
    return () => controller.abort()
  }, [slug])

  /**
   * The session this diner already has here, if any.
   *
   * Read once after mount rather than during render, because localStorage is not available on the
   * server and reading it in the initial state makes the markup disagree with the first client
   * render (the same note as lib/session.ts).
   */
  const [existing, setExisting] = useState<GuestSession | null>(null)
  useEffect(() => {
    const stored = readSession()
    // Same restaurant, still alive. A session for somewhere else must never send a diner to a
    // menu they did not scan for.
    if (stored !== null && stored.restaurantSlug === slug && !isExpired(stored)) {
      setExisting(stored)
    }
  }, [slug])

  const selectTable = useCallback(
    (tableUid: string) => {
      // Guarded so a double-tap on a slow connection cannot claim two tables and leave the
      // diner on whichever response landed second.
      if (claiming !== null) return

      /**
       * ALREADY SITTING HERE -- go straight through without minting anything.
       *
       * This was a real data-loss bug. Every visit to this page called select-table, which creates
       * a NEW guest session; a diner who rescanned the counter QR and tapped the table they were
       * already at silently lost their cart and their "my orders", because both are keyed to the
       * session that just got orphaned (docs/DECISIONS.md D5).
       *
       * Only when the table is UNCHANGED. Picking a different one is a genuine move and must mint
       * a session for it, or the kitchen sends food to where they used to be sitting.
       */
      if (existing !== null && existing.tableUid === tableUid) {
        router.replace('/menu')
        return
      }

      setClaiming(tableUid)

      api
        .selectTable(slug, { table_uid: tableUid })
        .then((scan) => {
          setSession(sessionFromScan(scan))
          router.replace('/menu')
        })
        .catch((err: unknown) => {
          setClaiming(null)
          setError(isApiError(err) ? err.message : 'Could not start ordering at that table.')
        })
    },
    [claiming, existing, router, setSession, slug],
  )

  if (error !== null) {
    return <CenteredMessage title="Could not start ordering" body={error} tone="warn" />
  }

  if (landing === null) {
    return (
      <CenteredMessage
        title="Loading"
        body={
          <span className="inline-flex items-center gap-2">
            <Spinner /> One moment
          </span>
        }
      />
    )
  }

  return (
    <>
      <ScreenHeader title={landing.restaurant.name} subtitle="Which table are you at?" />
      <main className="px-4 py-4">
        {/*
          A returning diner should not have to find their own table in a grid again.

          Shown ONLY when a live session for this restaurant already exists, and it never assumes:
          the table is named in the button, and the grid stays right below it under a heading that
          says what it is for. Auto-redirecting instead would be one tap fewer and occasionally
          catastrophic -- a diner who moved tables and rescanned the counter code would be sent
          silently back to where they used to sit, and their food with them.
        */}
        {existing !== null ? (
          <div className="mb-5">
            <PrimaryButton onClick={() => router.replace('/menu')}>
              Continue at Table {existing.tableLabel}
            </PrimaryButton>
            <p className="mt-3 text-center text-[0.8125rem] text-muted">
              Moved? Pick your new table below.
            </p>
          </div>
        ) : null}

        {landing.tables.length === 0 ? (
          <EmptyState
            title="No tables available"
            description="Please ask a staff member to take your order."
          />
        ) : (
          <ul className="grid grid-cols-3 gap-3">
            {landing.tables.map((table) => (
              <li key={table.uid}>
                <button
                  type="button"
                  onClick={() => selectTable(table.uid)}
                  disabled={claiming !== null}
                  className="flex min-h-[4.5rem] w-full flex-col items-center justify-center rounded-card border border-line bg-surface px-2 py-3 text-center transition-opacity active:opacity-70 disabled:opacity-40"
                >
                  <span className="text-[0.6875rem] uppercase tracking-wide text-muted">Table</span>
                  <span className="text-lg font-semibold leading-tight">{table.label}</span>
                  {claiming === table.uid ? <Spinner /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-center text-[0.8125rem] leading-relaxed text-muted">
          Choosing the wrong table sends your food to someone else — please check the number on your
          table before continuing.
        </p>
      </main>
    </>
  )
}
