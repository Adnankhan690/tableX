'use client'

import type { OrderView, TransitionTarget } from '@tablex/shared'
import {
  elapsedSeconds,
  formatElapsed,
  PAYMENT_STATUS_LABEL,
  requiresReason,
  TRANSITION_VERB,
} from '@tablex/shared'
import { cn, FoodTypeBadge, Money, StatusBadge } from '@tablex/ui'
import Link from 'next/link'

/**
 * Age thresholds for the board, in seconds.
 *
 * Named constants rather than inline numbers because these are a product decision, not a
 * styling detail: they are the point at which staff should feel prompted to act, and the PRD's
 * order-throughput metric depends on them being noticed (PRD 3). Two minutes to accept is
 * generous during a rush; five is late enough that a diner is wondering.
 */
export const AGE_WARN_SECONDS = 120
export const AGE_LATE_SECONDS = 300

/**
 * How loudly an order should read, given how long it has been waiting.
 *
 * Escalation applies only to `placed`: once accepted, the clock a diner cares about is the
 * kitchen's, and tinting a dish that is legitimately taking twenty minutes to cook would train
 * staff to ignore the colour entirely.
 */
export function ageTone(order: OrderView, now: number): 'calm' | 'warn' | 'late' {
  if (order.status !== 'placed') return 'calm'
  const waited = elapsedSeconds(order.placed_at, now)
  if (waited >= AGE_LATE_SECONDS) return 'late'
  if (waited >= AGE_WARN_SECONDS) return 'warn'
  return 'calm'
}

/** Counts the veg/non-veg split, so the kitchen can see the shape of a ticket at a glance. */
function foodMix(order: OrderView) {
  const mix = { veg: 0, non_veg: 0, egg: 0 }
  for (const item of order.items) {
    if (item.status !== 'active') continue
    mix[item.food_type] += item.quantity
  }
  return mix
}

export function OrderCard({
  order,
  now,
  onTransition,
  busy,
}: {
  order: OrderView
  now: number
  onTransition: (target: TransitionTarget) => void
  busy?: boolean
}) {
  const tone = ageTone(order, now)
  const mix = foodMix(order)
  const waited = elapsedSeconds(order.placed_at, now)

  return (
    <article
      data-age-tone={tone}
      className={cn(
        'rounded-card border bg-surface p-3 shadow-card',
        tone === 'late' ? 'border-danger bg-age-late' : '',
        tone === 'warn' ? 'border-age-warn-line bg-age-warn' : '',
        tone === 'calm' ? 'border-line' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Order number and table are both large: staff match a ticket to a table by eye, and
              call the number across the kitchen. */}
          <p className="text-base font-bold leading-tight tabular-nums">{order.order_number}</p>
          <p className="text-sm font-semibold leading-tight">Table {order.table_label}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} audience="staff" />
          <span
            className={cn(
              'text-xs tabular-nums',
              tone === 'late' ? 'font-semibold text-danger' : 'text-muted',
            )}
          >
            {formatElapsed(waited)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
        </span>
        <span className="flex items-center gap-1">
          {mix.veg > 0 ? (
            <span className="flex items-center gap-0.5">
              <FoodTypeBadge type="veg" size={11} /> {mix.veg}
            </span>
          ) : null}
          {mix.non_veg > 0 ? (
            <span className="flex items-center gap-0.5">
              <FoodTypeBadge type="non_veg" size={11} /> {mix.non_veg}
            </span>
          ) : null}
          {mix.egg > 0 ? (
            <span className="flex items-center gap-0.5">
              <FoodTypeBadge type="egg" size={11} /> {mix.egg}
            </span>
          ) : null}
        </span>
        <Money money={order.totals.total} className="font-medium text-ink" />
        <span className={cn(order.payment_status === 'paid' ? 'text-success' : 'text-muted')}>
          {order.payment_method === 'counter' ? 'Counter' : 'UPI'} ·{' '}
          {PAYMENT_STATUS_LABEL[order.payment_status]}
        </span>
      </div>

      {/*
        The action buttons are generated from what the SERVER says is legal
        (docs/DECISIONS.md D1). Hard-coding them here is how a UI ends up offering a button that
        409s -- and the server already computes this exact set, so mirroring it would be both
        duplicated and eventually wrong.
      */}
      {order.next_statuses && order.next_statuses.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {order.next_statuses.map((target) => (
            <button
              key={target}
              type="button"
              disabled={busy}
              onClick={() => onTransition(target)}
              className={cn(
                'min-h-tap rounded-card px-3 text-sm font-semibold disabled:opacity-40',
                requiresReason(target)
                  ? 'border border-danger text-danger'
                  : 'bg-accent text-accent-ink',
              )}
            >
              {TRANSITION_VERB[target]}
            </button>
          ))}
        </div>
      ) : null}

      <Link
        href={`/orders/${order.uid}`}
        className="mt-2 inline-block text-xs font-medium text-accent underline"
      >
        Open order
      </Link>
    </article>
  )
}
