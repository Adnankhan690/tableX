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
      ESCALATION RIDES THE EDGE, NOT THE FACE.

      A late ticket used to paint its whole card `bg-age-late`, which cost the board two things:
      every word and every button sat on saturated pink, and two late tickets in one column merged
      into a single continuous block with no visible seam between them. The signal now lives in a
      3px left bar plus a tinted header strip -- still unmissable across a kitchen, while the body
      stays white so the meta line and the buttons keep one predictable ground.
    */
    <article
      data-age-tone={tone}
      className="relative overflow-hidden rounded-card border border-line bg-surface shadow-card"
    >
      {/* The bar is a positioned element rather than a `border-l-*` colour, because Tailwind emits
          `border-{color}` after `border-l-{color}` in its own canonical order: `border-line` won,
          and the left edge fell back to currentColor -- a near-black bar on every late ticket. A
          background cannot be overridden by a border rule, so this cannot regress the same way. */}
      {tone !== 'calm' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 w-[3px]',
            tone === 'late' ? 'bg-age-late' : 'bg-age-warn',
          )}
        />
      ) : null}

      <div
        className={cn(
          'flex items-start justify-between gap-2 px-3 pb-2 pt-2.5',
          tone === 'late' ? 'bg-age-late-tint' : '',
          tone === 'warn' ? 'bg-age-warn-tint' : '',
        )}
      >
        <div className="min-w-0">
          {/* Order number and table are both large: staff match a ticket to a table by eye, and
              call the number across the kitchen. */}
          <p className="text-lg font-semibold leading-tight [font-variant-numeric:tabular-nums]">
            {order.order_number}
          </p>
          <p className="truncate text-sm font-medium leading-tight text-muted">
            Table {order.table_label}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} audience="staff" />
          <span
            className={cn(
              'text-xs [font-variant-numeric:tabular-nums]',
              tone === 'late' ? 'font-semibold text-danger' : 'text-muted',
            )}
          >
            {formatElapsed(waited)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-xs text-muted">
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
        duplicated and eventually wrong. Only the render ORDER and the weight are ours -- and the
        order has to be ours, because the server sorts the set with sort.Strings
        (order_state.go): "cancelled" sorts before "preparing", "ready" and "served", so Cancel
        arrived FIRST on four of the five live columns. The forward transition is taken hundreds of
        times a service and the refusals a handful, so a destructive verb top-left -- where the eye
        lands and the thumb reaches -- was a mis-tap generator, and every mis-tap opens a reason
        dialog on a real order.

        Three weights, not two. Before, the forward transition and both refusals were the same
        40px pill differing only in fill, so Cancel and Reject -- two irreversible actions with
        different meanings -- were visually identical to each other and nearly as loud as the
        action taken every time.
      */}
      {actions.length > 0 ? (
        /*
          Two groups, not one flat row: the forward transition on the left, the refusals on the
          right. When the card is too narrow for all three -- a 310px column at 1440 cannot hold
          "Accept", "Cancel" and "Reject" -- the refusal GROUP wraps as a unit instead of stranding
          one red verb on its own line under the primary action, which is what a single flex row
          with a spacer did.
        */
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-divider px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {forward.map((target) => (
              <Button
                key={target}
                size="sm"
                variant="primary"
                disabled={Boolean(pending) && pending !== target}
                loading={pending === target}
                loadingLabel={`${TRANSITION_VERB[target]}…`}
                onClick={() => onTransition(target)}
              >
                {TRANSITION_VERB[target]}
              </Button>
            ))}
          </div>
          {refusals.length > 0 ? (
            <div className="ml-auto flex items-center gap-0.5">
              {refusals.map((target) => (
                <Button
                  key={target}
                  size="sm"
                  variant="danger-quiet"
                  disabled={Boolean(pending) && pending !== target}
                  loading={pending === target}
                  loadingLabel={`${TRANSITION_VERB[target]}…`}
                  onClick={() => onTransition(target)}
                >
                  {TRANSITION_VERB[target]}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        The whole card is the link target, and this is its visible affordance: a 16px underlined
        link inside a 40px-target world was the smallest control on the busiest screen. `absolute
        inset-0` would swallow the buttons above, so the link stays a real row instead.
      */}
      <Link
        href={`/orders/${order.uid}`}
        className={cn(
          'flex min-h-tap items-center justify-between gap-2 px-3 text-sm font-medium text-muted',
          'transition-colors hover:bg-surface-sunken hover:text-accent',
          actions.length > 0 ? 'border-t border-divider' : 'mt-2.5 border-t border-divider',
        )}
      >
        Open order
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          className="h-4 w-4"
        >
          <path d="M8 5l5 5-5 5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </article>
  )
}
