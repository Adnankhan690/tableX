'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderView } from '@tablex/shared'
import { elapsedSeconds, formatElapsed } from '@tablex/shared'
import { EmptyState, ErrorState, Money, Spinner, StatusBadge } from '@tablex/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BackLink, ScreenHeader } from '@/components/screen'
import { useGatedSession } from '@/components/session-gate'
import { api } from '@/lib/api'

/**
 * The orders placed from this session (docs/DECISIONS.md D5).
 *
 * Scoped to the sitting, not to a person. A table that orders three times over a meal sees all
 * three; the same diner returning next week sees nothing, because there is no account and
 * identifying them would need a login -- which is the friction this product exists to remove.
 */
export function OrderList() {
  const session = useGatedSession()

  const [orders, setOrders] = useState<OrderView[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    setError(null)
    api
      .listMyOrders(session.token)
      .then((result) => setOrders(result.orders))
      .catch(setError)
  }, [session.token])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <ScreenHeader
        title="Your orders"
        subtitle={`Table ${session.tableLabel} · this visit`}
        back={<BackLink href="/menu" label="Back to the menu" />}
      />

      <main className="px-4 py-4">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load your orders.'}
            {...(isApiError(error) && error.code ? { code: error.code } : {})}
            {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
            onRetry={load}
          />
        ) : orders === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Spinner /> Loading
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Anything you order at this table will show up here."
            action={
              <Link href="/menu" className="text-[0.9375rem] font-medium text-accent">
                Browse the menu
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.uid}>
                <Link
                  href={`/orders/${order.uid}`}
                  className="block rounded-card border border-line bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[1.0625rem] font-semibold tabular-nums">
                        {order.order_number}
                      </p>
                      <p className="mt-0.5 text-[0.8125rem] text-muted">
                        {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                        <span className="mx-1.5">·</span>
                        {/* Relative time, because "12 minutes ago" is what a diner is actually
                            wondering, not the wall-clock time they ordered. */}
                        {formatElapsed(elapsedSeconds(order.placed_at))} ago
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={order.status} audience="diner" />
                      <Money
                        money={order.totals.total}
                        className="text-[0.9375rem] font-semibold"
                      />
                    </div>
                  </div>
                  {order.payment_status !== 'paid' ? (
                    <p className="mt-2 text-[0.8125rem] text-muted">
                      {order.payment_method === 'counter'
                        ? 'Pay at the counter'
                        : 'Payment pending'}
                    </p>
                  ) : null}

                  {/*
                    The second way into the rating card, for a diner who left the tracking
                    screen before the food arrived -- which is most of them, because the
                    window opens after they have started eating and put the phone down.

                    Without this the feature depends on the diner happening to still have one
                    screen open, and the whole reason the window has time-based fallbacks is
                    that we cannot depend on timing going right.
                  */}
                  {order.can_review ? <ReviewPrompt order={order} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}

/**
 * The nudge on an order that can be rated.
 *
 * Says which state it is in rather than always inviting: a diner who has already rated
 * everything should see that it landed, not be asked again. "Rate" on an order they have
 * already rated reads as the first tap not having worked.
 */
function ReviewPrompt({ order }: { order: OrderView }) {
  const rateable = order.items.filter((item) => item.status !== 'cancelled')
  const rated = rateable.filter((item) => item.review).length

  if (rated === 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent">
        <Star />
        How was it? Rate your food
      </p>
    )
  }

  if (rated < rateable.length) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent">
        <Star />
        {rated} of {rateable.length} dishes rated
      </p>
    )
  }

  return (
    <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-muted">
      <Star />
      Thanks for rating
    </p>
  )
}

/** Inline SVG: this app ships no icon library, by design (PRD 7). */
function Star() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
    </svg>
  )
}
