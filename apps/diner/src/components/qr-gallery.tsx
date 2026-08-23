'use client'

import { isApiError } from '@tablex/api-client'
import type { RestaurantQR, RestaurantSummary } from '@tablex/shared'
import { Base64Image, EmptyState, ErrorState, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CenteredMessage, ScreenHeader } from '@/components/screen'
import { api } from '@/lib/api'

/**
 * One scannable QR per restaurant.
 *
 * Point a phone camera at a code here and it opens that restaurant's table picker, which is the
 * restaurant-level entry point the product already has (`/r/{slug}`, docs/DECISIONS.md D4). So this
 * page is a display surface over an existing flow rather than a new one — nothing here is a
 * shortcut that bypasses table selection or session creation.
 *
 * Two things it is useful for: testing the scan path from a laptop screen without printing
 * anything, and standing in for the real-world case of a multi-restaurant venue — a food court
 * board where each stall has its own code.
 *
 * The codes are rendered by the server. That keeps a QR library out of this bundle, which matters
 * because the diner app's payload is a product requirement (PRD §7) — and it means the encoded URL
 * comes from the server's own configured base URL rather than from whatever host the browser
 * happens to be on, so a code scanned from a laptop still points somewhere a phone can reach.
 */
export function QrGallery() {
  const [restaurants, setRestaurants] = useState<RestaurantSummary[] | null>(null)
  const [codes, setCodes] = useState<Record<string, RestaurantQR>>({})
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    setError(null)
    const controller = new AbortController()

    api
      .listRestaurants(controller.signal)
      .then((result) => {
        setRestaurants(result.restaurants)

        // One request per restaurant, and allSettled rather than all: a restaurant whose QR fails
        // to render should not blank out the codes that worked. The count is small and this page
        // is not on the ordering hot path, so N requests is the right trade against a bespoke
        // batch endpoint.
        return Promise.allSettled(
          result.restaurants.map((restaurant) =>
            api.restaurantQR(restaurant.slug, 320, controller.signal),
          ),
        )
      })
      .then((results) => {
        if (!results) return
        const next: Record<string, RestaurantQR> = {}
        for (const item of results) {
          if (item.status === 'fulfilled') next[item.value.slug] = item.value
        }
        setCodes(next)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error !== null) {
    return (
      <>
        <ScreenHeader title="Scan to order" />
        <ErrorState
          message={isApiError(error) ? error.message : 'Could not load the restaurants.'}
          {...(isApiError(error) && error.code ? { code: error.code } : {})}
          {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
          onRetry={load}
        />
      </>
    )
  }

  if (restaurants === null) {
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
      <ScreenHeader title="Scan to order" subtitle="Point your camera at a code" />

      <main className="px-4 pb-10 pt-4">
        {restaurants.length === 0 ? (
          <EmptyState
            title="No restaurants are taking orders"
            description="Ask a staff member to help you order."
          />
        ) : (
          <ul className="space-y-4">
            {restaurants.map((restaurant) => {
              const code = codes[restaurant.slug]

              return (
                <li
                  key={restaurant.uid}
                  className="overflow-hidden rounded-card border border-line bg-surface"
                >
                  <div className="border-b border-line px-4 py-3">
                    <p className="text-[1.0625rem] font-semibold leading-tight">
                      {restaurant.name}
                    </p>
                    {restaurant.description ? (
                      <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
                        {restaurant.description}
                      </p>
                    ) : null}
                    {restaurant.address ? (
                      <p className="mt-0.5 text-[0.75rem] text-muted">{restaurant.address}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-center gap-3 px-4 py-4">
                    {code?.png_base64 ? (
                      /* On white regardless of theme: a QR rendered inverted in dark mode does not
                         scan, and this page exists to be scanned. */
                      <Base64Image
                        png={code.png_base64}
                        alt={`QR code to order at ${restaurant.name}`}
                        size={220}
                        className="rounded-card p-3"
                      />
                    ) : (
                      <div className="flex h-[220px] w-[220px] items-center justify-center rounded-card bg-surface-sunken text-[0.8125rem] text-muted">
                        <span className="inline-flex items-center gap-2">
                          <Spinner /> Rendering
                        </span>
                      </div>
                    )}

                    <p className="text-center text-[0.8125rem] leading-snug text-muted">
                      Scan to see the menu and order at {restaurant.name}.
                    </p>

                    {/* A tap-through for anyone already reading this on the phone they would
                        scan with -- pointing a camera at your own screen is impossible. */}
                    <Link
                      href={`/r/${restaurant.slug}`}
                      className="text-[0.9375rem] font-semibold text-accent"
                    >
                      Or open it directly →
                    </Link>

                    {code ? (
                      <code className="select-all break-all text-center text-[0.6875rem] text-muted">
                        {code.qr_url}
                      </code>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-6 text-center text-[0.75rem] leading-relaxed text-muted">
          Scanning a code opens that restaurant&apos;s table list. Pick the table you are sitting at
          — choosing the wrong one sends your food elsewhere.
        </p>
      </main>
    </>
  )
}
