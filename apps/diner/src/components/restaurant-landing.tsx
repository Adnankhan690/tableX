'use client'

import { isApiError } from '@tablex/api-client'
import type { RestaurantLandingResponse } from '@tablex/shared'
import { EmptyState, Spinner } from '@tablex/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/components/providers'
import { CenteredMessage, ScreenHeader } from '@/components/screen'
import { api } from '@/lib/api'
import { sessionFromScan } from '@/lib/session'

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

  const selectTable = useCallback(
    (tableUid: string) => {
      // Guarded so a double-tap on a slow connection cannot claim two tables and leave the
      // diner on whichever response landed second.
      if (claiming !== null) return
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
    [claiming, router, setSession, slug],
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
