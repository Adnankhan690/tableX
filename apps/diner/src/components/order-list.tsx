'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderView } from '@tablex/shared'
import { elapsedSeconds, formatElapsed } from '@tablex/shared'
import { EmptyState, ErrorState, Money, Spinner, StatusBadge } from '@tablex/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ScreenHeader } from '@/components/screen'
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
        back={
          <Link
            href="/menu"
            aria-label="Back to the menu"
            className="-ml-2 flex min-h-tap min-w-tap items-center justify-center text-xl text-muted"
          >
            ←
          </Link>
        }
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
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
