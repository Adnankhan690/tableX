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
import { Button } from '@/components/ui'

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
  pending,
}: {
  order: OrderView
  now: number
  onTransition: (target: TransitionTarget) => void
  /**
   * The transition currently in flight on THIS order, or null.
   *
   * A target rather than a boolean: one `busy` flag used to fade every button on every card at
   * once, so pressing Accept on one ticket greyed out the whole board with no indication of which
   * request was actually running.
   */
  pending?: TransitionTarget | null
}) {
  const tone = ageTone(order, now)
  const mix = foodMix(order)
  const waited = elapsedSeconds(order.placed_at, now)
  const actions = order.next_statuses ?? []
  const forward = actions.filter((t) => !requiresReason(t))
  const refusals = actions.filter((t) => requiresReason(t))

  return (
    /*
      The tinted card is the escalation signal, and it is deliberately the loud version: a whole-card
      tint is recognisable across a kitchen in a way an edge bar is not, and knowing which tickets
      are overdue at a glance is what the board is for. The cost is that every word and button here
      sits on a tint, so --ad-age-late/-warn are checked against ink, muted AND danger in
      globals.css -- they are the binding constraint on the palette, not decoration.
    */
    <article
      data-age-tone={tone}
      className={cn(
        'rounded-card border bg-surface p-3 shadow-card transition-colors',
        tone === 'late' ? 'border-danger bg-age-late' : '',
        tone === 'warn' ? 'border-age-warn-line bg-age-warn' : '',
        tone === 'calm' ? 'border-line' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Order number and table are both large: staff match a ticket to a table by eye, and
              call the number across the kitchen. */}
          <p className="text-lg font-bold leading-tight [font-variant-numeric:tabular-nums]">
            {order.order_number}
          </p>
          <p className="truncate text-base font-semibold leading-tight">
            Table {order.table_label}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} audience="staff" />
          <span
            className={cn(
              'text-sm [font-variant-numeric:tabular-nums]',
              tone === 'late' ? 'font-semibold text-danger' : 'text-muted',
            )}
          >
            {formatElapsed(waited)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
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
        <Money
          money={order.totals.total}
          className="font-medium text-ink [font-variant-numeric:tabular-nums]"
        />
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

        The render ORDER is ours, and it has to be: the server sorts the set with sort.Strings
        (order_state.go), so "cancelled" precedes "preparing", "ready" and "served" and Cancel
        arrived FIRST on four of the five live columns. The forward transition is taken hundreds of
        times a service and the refusals a handful, so a destructive verb top-left -- where the eye
        lands and the thumb reaches -- was a mis-tap generator, and every mis-tap opens a reason
        dialog on a real order.

        All three sit at one size, in one row, so a staff member sees every legal move at once
        without reading -- weight, not size, says which one is expected. They are the compact size
        for one specific reason: at 1440 a five-column board gives each card about 300px, and three
        buttons at the default width do not fit, so "Reject" wrapped onto a second row on its own
        underneath the primary. Measured, not guessed: a card is 224px at that width, giving the row
        198px, and three compact buttons at the default 10px padding need 208px. `px-2` and a 6px
        gap bring it to 192px, so the row holds.
      */}
      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {forward.map((target) => (
            <Button
              key={target}
              size="sm"
              variant="primary"
              disabled={Boolean(pending) && pending !== target}
              loading={pending === target}
              loadingLabel={`${TRANSITION_VERB[target]}…`}
              onClick={() => onTransition(target)}
              className="px-2"
            >
              {TRANSITION_VERB[target]}
            </Button>
          ))}
          {refusals.map((target) => (
            <Button
              key={target}
              size="sm"
              variant="danger-outline"
              disabled={Boolean(pending) && pending !== target}
              loading={pending === target}
              loadingLabel={`${TRANSITION_VERB[target]}…`}
              onClick={() => onTransition(target)}
              className="px-2"
            >
              {TRANSITION_VERB[target]}
            </Button>
          ))}
        </div>
      ) : null}

      {/*
        A link, not a row: the card stays compact, which is what lets four tickets fit in a column
        during a rush. `inline-flex` with vertical padding rather than `inline-block` is the one
        change from the original -- it was a 16px-tall target on the busiest screen in the product,
        and this app holds a 40px floor for anything tappable on a tablet.
      */}
      <Link
        href={`/orders/${order.uid}`}
        className="mt-1 inline-flex min-h-tap items-center text-sm font-medium text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent"
      >
        Open order
      </Link>
    </article>
  )
}
