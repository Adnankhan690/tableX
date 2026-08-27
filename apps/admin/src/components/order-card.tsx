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
import { useId, useState } from 'react'
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
  /**
   * Collapsed by default, and per card rather than one-at-a-time.
   *
   * A single-open accordion is right for a FAQ, where the answers are alternatives. These are not:
   * during a rush a staff member compares two tickets, and closing one to read another would make
   * the control fight the task.
   */
  const [expanded, setExpanded] = useState(false)
  const ticketId = useId()
  const actions = order.next_statuses ?? []
  const forward = actions.filter((t) => !requiresReason(t))
  const refusals = actions.filter((t) => requiresReason(t))

  return (
    /*
      A TICKET, not a summary row.

      The card used to say "2 items" and stop, so answering "what did table 1 actually order" meant
      opening a detail page and losing the board. The lines are here now, behind a collapse: shut,
      the card is as compact as it was; open, it is the ticket a staff member would otherwise walk
      to the pass to read.

      The tinted card is the escalation signal, and it is deliberately the loud version: a
      whole-card tint is recognisable across a kitchen in a way an edge bar is not, and knowing
      which tickets are overdue at a glance is what the board is for.

      It is a gradient, not a flat fill. The tint holds through the top half -- the order number,
      the status pill, the clock -- and fades to the card surface by the bottom, so the buttons sit
      on near-white instead of on pink, where a white outlined button read as a hole punched in the
      card and the blue primary clashed with the tint. See globals.css: those two tints are the
      binding contrast constraint on the whole palette.
    */
    <article
      data-age-tone={tone}
      data-expanded={expanded || undefined}
      className={cn(
        'rounded-card border bg-surface shadow-card transition-colors',
        // `via` at the default 50% is what holds the tint through the top half before it fades;
        // a two-stop gradient would start washing out at the meta line.
        tone === 'late'
          ? 'border-age-late-line bg-gradient-to-b from-age-late via-age-late to-surface'
          : '',
        tone === 'warn'
          ? 'border-age-warn-line bg-gradient-to-b from-age-warn via-age-warn to-surface'
          : '',
        tone === 'calm' ? 'border-line' : '',
      )}
    >
      {/*
        The header is the toggle. A separate chevron button would be a second 40px target on a card
        that already has three, and the whole header is the obvious thing to press to see more.
      */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={ticketId}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start justify-between gap-2 rounded-t-card px-3 pb-2 pt-3 text-left"
      >
        <span className="min-w-0">
          {/* Order number and table are both large: staff match a ticket to a table by eye, and
              call the number across the kitchen. */}
          <span className="block text-lg font-bold leading-tight [font-variant-numeric:tabular-nums]">
            {order.order_number}
          </span>
          <span className="block truncate text-base font-semibold leading-tight">
            Table {order.table_label}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} audience="staff" />
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'text-sm [font-variant-numeric:tabular-nums]',
                tone === 'late' ? 'font-semibold text-danger' : 'text-muted',
              )}
            >
              {formatElapsed(waited)}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              className={cn(
                'h-4 w-4 text-muted transition-transform duration-300 motion-reduce:transition-none',
                expanded ? 'rotate-180' : '',
              )}
            >
              <path
                d="M6 8l4 4 4-4"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-sm text-muted">
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
        THE COLLAPSE IS PURE CSS.

        A grid whose single row goes from `0fr` to `1fr` transitions to the content's own height --
        which `height: auto` cannot do -- so there is no measuring, no ResizeObserver, and no
        layout thrash on a board that re-renders every second. `overflow-hidden` clips during the
        transition and the inner `min-h-0` is what lets the row actually reach zero; without it the
        child's min-content height holds the row open.

        Honoured for reduced motion: the state change is instant rather than animated, because a
        board that re-renders once a second is exactly where unwanted motion accumulates.
      */}
      <div
        id={ticketId}
        role="region"
        aria-label={`Items on order ${order.order_number}`}
        className={cn(
          'grid overflow-hidden px-3 transition-[grid-template-rows] duration-300 ease-out',
          'motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          {/* A dashed rule, once, where a paper ticket would be torn. It is the one decorative
              stroke on this card and it is doing a job: it says "what follows is the order". */}
          <ul className="mt-2 border-t border-dashed border-line-strong pt-2">
            {order.items.map((item) => (
              <li
                key={item.uid}
                className={cn(
                  'grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-baseline gap-x-2 py-0.5 text-sm',
                  // Struck through, not removed: a line the kitchen already read has to stay
                  // visible, or the total stops explaining itself.
                  item.status === 'cancelled' ? 'text-muted line-through' : 'text-ink',
                )}
              >
                <FoodTypeBadge type={item.food_type} size={11} />
                <span className="font-semibold [font-variant-numeric:tabular-nums]">
                  {item.quantity}×
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{item.name}</span>
                  {item.note ? (
                    // The kitchen's actual instruction. Never truncated: "no chilli" is the whole
                    // reason the line is different from every other one.
                    <span className="block text-xs italic text-muted">
                      &ldquo;{item.note}&rdquo;
                    </span>
                  ) : null}
                </span>
                <Money
                  money={item.total}
                  className="text-right [font-variant-numeric:tabular-nums]"
                />
              </li>
            ))}
          </ul>

          <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5 text-sm">
            <span className="text-muted">Total</span>
            <Money
              money={order.totals.total}
              className="font-semibold [font-variant-numeric:tabular-nums]"
            />
          </div>

          {order.customer_name || order.note ? (
            <div className="mt-1.5 text-sm">
              {order.customer_name ? (
                <p className="truncate font-medium">{order.customer_name}</p>
              ) : null}
              {order.note ? <p className="italic text-muted">&ldquo;{order.note}&rdquo;</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        The action buttons are generated from what the SERVER says is legal
        (docs/DECISIONS.md D1). Hard-coding them here is how a UI ends up offering a button that
        409s -- and the server already computes this exact set, so mirroring it would be both
        duplicated and eventually wrong.

        The render ORDER and the weight are ours -- and the order has to be, because the server
        sorts the set with sort.Strings (order_state.go): "cancelled" precedes "preparing", "ready"
        and "served", so Cancel arrived FIRST on four of the five live stages. The forward
        transition is taken hundreds of times a service and the refusals a handful, so a
        destructive verb top-left -- where the eye lands and the thumb reaches -- was a mis-tap
        generator, and every mis-tap opens a reason dialog on a real order.

        They stay OUTSIDE the collapse: accepting a ticket must never require expanding it first.
        Measured, not guessed: a card is 224px at 1440 in a four-up grid, giving the row 198px, and
        three compact buttons at the default 10px padding need 208px. `px-2` and a 6px gap bring it
        to 192px, so the row holds.
      */}
      {actions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-3">
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
        A link, not a row: the card stays compact, which is what lets four tickets fit during a
        rush. `inline-flex` with vertical padding rather than `inline-block` is the one change from
        the original -- it was a 16px-tall target on the busiest screen in the product, and this app
        holds a 40px floor for anything tappable on a tablet.
      */}
      <div className="px-3 pb-1">
        <Link
          href={`/orders/${order.uid}`}
          className="inline-flex min-h-tap items-center text-sm font-medium text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent"
        >
          Open order
        </Link>
      </div>
    </article>
  )
}
