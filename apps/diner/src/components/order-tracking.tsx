'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderView, PaymentStatusResponse } from '@tablex/shared'
import {
  DINER_PROGRESS_STEPS,
  DINER_STATUS_LABEL,
  elapsedSeconds,
  isTerminal,
  progressFraction,
} from '@tablex/shared'
import { cn, ErrorState, FoodTypeBadge, Money, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PaymentPanel } from '@/components/payment-panel'
import { RateOrder } from '@/components/rate-order'
import { CenteredMessage, ScreenHeader } from '@/components/screen'
import { useGatedSession } from '@/components/session-gate'
import { useOrderStream } from '@/hooks/useOrderStream'
import { api } from '@/lib/api'
import { unconfirmedStage } from '@/lib/order-waiting'

/**
 * How often the screen re-reads the clock while an order sits unconfirmed.
 *
 * Needed because nothing else re-renders here: with the socket connected there is no polling, so
 * without a tick the notice would appear only when the order itself changed -- which, for an order
 * nobody is touching, is never.
 */
const CLOCK_TICK_MS = 30_000

/** The order progress screen (PRD 6.5). */
export function OrderTracking({ orderUid }: { orderUid: string }) {
  const session = useGatedSession()

  const [order, setOrder] = useState<OrderView | null>(null)
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [cancelling, setCancelling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refetch = useCallback(() => {
    api
      .getOrder(session.token, orderUid)
      .then((fresh) => {
        setOrder(fresh)
        setError(null)
      })
      .catch((err: unknown) => setError(err))

    // Fetched alongside rather than conditionally: the payment block has to appear the moment
    // it becomes relevant, and waiting for the next poll to notice would leave a diner who
    // just chose UPI staring at a screen with no way to pay.
    api
      .getPaymentStatus(session.token, orderUid)
      .then(setPayment)
      .catch(() => {
        /* An order can legitimately have no payment yet. */
      })
  }, [orderUid, session.token])

  useEffect(() => {
    refetch()
  }, [refetch])

  /**
   * A clock that ticks only while it is needed.
   *
   * Gated on the order still being unconfirmed, so a completed order on a phone left on the table
   * is not waking a timer every thirty seconds for the rest of the evening.
   */
  const [now, setNow] = useState(() => Date.now())
  const unconfirmed = order?.status === 'placed'
  useEffect(() => {
    if (!unconfirmed) return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [unconfirmed])

  const terminal = order !== null && isTerminal(order.status)

  /**
   * Open the rating card at the exact moment the server said it would open.
   *
   * The window does not always open on a status change -- it also opens on a timeout after the
   * kitchen stops updating the order, which is the whole reason a diner at a restaurant that
   * forgets to tap "served" still gets asked (see review_window.go). Nothing pushes an event
   * for a deadline passing, so without this the card waits for the next poll, and on a
   * terminal order polling has already stopped and it would never appear at all.
   */
  const reviewOpensAt = order?.review_opens_at ?? null
  useEffect(() => {
    if (reviewOpensAt === null) return

    const waitMs = new Date(reviewOpensAt).getTime() - Date.now()
    if (waitMs <= 0) {
      refetch()
      return
    }
    // Clamped: setTimeout overflows past ~24.8 days and fires immediately, and a window that
    // far out will be picked up by the next visit anyway.
    if (waitMs > 24 * 60 * 60 * 1000) return

    const timer = setTimeout(refetch, waitMs)
    return () => clearTimeout(timer)
  }, [refetch, reviewOpensAt])

  // Live updates, with polling as a complete fallback (docs/DECISIONS.md D10). Polling stops
  // once the order is closed -- a completed order will never change again.
  const { live } = useOrderStream(orderUid, session.token, refetch, terminal)

  const cancel = useCallback(() => {
    if (cancelling) return
    setCancelling(true)
    setNotice(null)

    api
      .cancelOrder(session.token, orderUid)
      .then((fresh) => {
        setOrder(fresh)
        setCancelling(false)
      })
      .catch((err: unknown) => {
        setCancelling(false)

        /**
         * A 409 here is the kitchen accepting the order in the same moment the diner tapped
         * cancel (docs/DECISIONS.md D6). That is not an error worth alarming them about -- it
         * is a race with a definite outcome. Refetching makes the button disappear on its own
         * and the note explains why.
         */
        if (isApiError(err) && err.isStale) {
          setNotice('The kitchen has already started your order, so it can no longer be cancelled.')
          refetch()
          return
        }
        setNotice(isApiError(err) ? err.message : 'Could not cancel the order.')
      })
  }, [cancelling, orderUid, refetch, session.token])

  if (error !== null && order === null) {
    return (
      <>
        <ScreenHeader title="Your order" subtitle={`Table ${session.tableLabel}`} />
        <ErrorState
          message={isApiError(error) ? error.message : 'Could not load this order.'}
          {...(isApiError(error) && error.code ? { code: error.code } : {})}
          {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
          onRetry={refetch}
        />
      </>
    )
  }

  if (order === null) {
    return (
      <CenteredMessage
        title="Loading your order"
        body={
          <span className="inline-flex items-center gap-2">
            <Spinner /> One moment
          </span>
        }
      />
    )
  }

  const failed = order.status === 'cancelled' || order.status === 'rejected'

  return (
    <>
      <ScreenHeader
        title={session.restaurantName}
        subtitle={`Table ${order.table_label}`}
        right={
          <Link href="/menu" className="shrink-0 text-[0.8125rem] font-medium text-accent">
            Order more
          </Link>
        }
      />

      <main className="space-y-4 px-4 pb-10 pt-4">
        {/* The order number is large because it is what staff will call out
            (docs/DECISIONS.md D9). */}
        <section className="rounded-card border border-line bg-surface p-4 text-center">
          <p className="text-[0.75rem] uppercase tracking-wide text-muted">Order</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums">{order.order_number}</p>

          <p
            className={cn(
              'mt-3 text-[1.0625rem] font-semibold',
              failed ? 'text-nonveg' : 'text-ink',
            )}
          >
            {DINER_STATUS_LABEL[order.status]}
          </p>

          {failed && order.cancel_reason ? (
            // The diner is owed an explanation. An order that vanishes with no reason is the
            // single most trust-destroying outcome in this flow.
            <p className="mt-1 text-[0.875rem] text-muted">{order.cancel_reason}</p>
          ) : null}

          {!failed ? <ProgressBar status={order.status} /> : null}

          <div className="mt-3 flex items-center justify-center gap-2 text-[0.75rem] text-muted">
            <span
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-veg' : 'bg-muted')}
            />
            {live ? 'Updating live' : 'Checking every few seconds'}
            <button type="button" onClick={refetch} className="font-medium text-accent underline">
              Refresh
            </button>
          </div>
        </section>

        {/*
          Said plainly, once waiting has stopped being normal.

          DELIBERATELY NOT A COUNTDOWN, and not a second progress bar. A countdown puts a clock on
          the restaurant's failure and hands the diner the anxiety, and it promises something that
          is not true -- staff may accept at any moment, and then the number was a lie. A progress
          bar means "this is advancing"; nothing is advancing, and the bar above is already telling
          that story honestly.

          Elapsed time is a fact the diner can act on. Remaining time is a threat.
        */}
        {unconfirmed ? (
          <UnconfirmedNotice
            placedAt={order.placed_at}
            now={now}
            orderNumber={order.order_number}
          />
        ) : null}

        {notice !== null ? (
          <p
            role="status"
            className="rounded-card bg-surface-sunken p-3 text-[0.875rem] text-muted"
          >
            {notice}
          </p>
        ) : null}

        {/*
          Rendered strictly from the server's flag, never from a local status check
          (docs/DECISIONS.md D6). The server owns the cancel window, so the button exists
          exactly when pressing it will work.
        */}
        {order.can_guest_cancel ? (
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling}
            className="min-h-tap w-full rounded-card border border-nonveg bg-surface px-4 text-[0.9375rem] font-medium text-nonveg disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel this order'}
          </button>
        ) : null}

        {payment !== null &&
        order.payment_status !== 'paid' &&
        order.payment_method === 'online_upi' ? (
          <PaymentPanel payment={payment.payment} />
        ) : null}

        {/*
          Rendered strictly from the server's flag, exactly like the cancel button above. The
          server owns the rating window, so the card exists precisely when submitting will
          work -- and notably the rule is NOT `status === 'served'`, so this must not be
          "improved" into a local status check (docs/DECISIONS.md D1, and review_window.go).

          Above the bill and the timeline on purpose: once the food has arrived, "how was it"
          is the only thing left on this screen a diner can act on.
        */}
        {order.can_review ? <RateOrder order={order} onWindowClosed={refetch} /> : null}

        {order.payment_method === 'counter' && order.payment_status !== 'paid' ? (
          <section className="rounded-card border border-line bg-surface p-4">
            <p className="text-[0.9375rem] font-semibold">Pay at the counter</p>
            <p className="mt-1 text-[0.8125rem] leading-snug text-muted">
              Please pay <Money money={order.totals.total} className="font-semibold" /> when you
              leave. Quote order {order.order_number}.
            </p>
          </section>
        ) : null}

        <section className="rounded-card border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
            Your order
          </h2>
          <ul>
            {order.items.map((item) => (
              <li
                key={item.uid}
                className={cn(
                  'flex items-start gap-2 border-b border-line px-4 py-2.5 last:border-b-0',
                  // A cancelled line is struck through, not removed: the diner needs to see
                  // that it was taken off and why the total changed.
                  item.status === 'cancelled' && 'text-muted line-through',
                )}
              >
                <FoodTypeBadge type={item.food_type} size={13} />
                <span className="min-w-0 flex-1 text-[0.9375rem]">
                  {item.quantity} × {item.name}
                  {item.note ? (
                    <span className="mt-0.5 block text-[0.8125rem] italic text-muted">
                      “{item.note}”
                    </span>
                  ) : null}
                </span>
                <Money money={item.total} className="text-[0.9375rem]" />
              </li>
            ))}
          </ul>

          {/* Totals come from the server's order, not recomputed. This is the bill. */}
          <div className="space-y-1 px-4 py-3">
            <TotalRow label="Subtotal" money={order.totals.subtotal} />
            {order.totals.tax.minor > 0 ? <TotalRow label="GST" money={order.totals.tax} /> : null}
            {order.totals.service_charge.minor > 0 ? (
              <TotalRow label="Service charge" money={order.totals.service_charge} />
            ) : null}
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <span className="text-[1rem] font-semibold">Total</span>
              <Money money={order.totals.total} className="text-[1rem] font-semibold" />
            </div>
          </div>
        </section>

        {order.timeline && order.timeline.length > 0 ? (
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
              Progress
            </h2>
            <ol className="mt-2 space-y-1.5">
              {order.timeline.map((event, index) => (
                <li
                  key={`${event.status}-${event.at}-${index}`}
                  className="flex items-baseline justify-between text-[0.875rem]"
                >
                  <span>{DINER_STATUS_LABEL[event.status]}</span>
                  <time dateTime={event.at} className="text-[0.8125rem] tabular-nums text-muted">
                    {new Date(event.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </main>
    </>
  )
}

/**
 * What the diner is told while nobody has picked up their order.
 *
 * Two stages, because they call for different things. At eight minutes the useful information is
 * that this is not normal, and that cancelling is available -- the state machine already permits it
 * while the order is `placed` (docs/DECISIONS.md D6), it was simply never framed as the answer to
 * anything. At twenty minutes waiting longer cannot help, so the screen stops offering options and
 * gives an instruction, with the number staff search by.
 */
function UnconfirmedNotice({
  placedAt,
  now,
  orderNumber,
}: {
  placedAt: string
  now: number
  orderNumber: string
}) {
  const waited = elapsedSeconds(placedAt, now)
  const stage = unconfirmedStage(waited)
  if (stage === 'none') return null

  const minutes = Math.floor(waited / 60)
  const escalated = stage === 'escalated'

  return (
    <section
      // Polite, not assertive: it must not interrupt whatever a screen-reader user is reading, and
      // nothing here is an emergency.
      aria-live="polite"
      className={cn(
        'rounded-card border p-4',
        escalated ? 'border-nonveg bg-surface' : 'border-line bg-surface-sunken',
      )}
    >
      <p className={cn('text-[0.9375rem] font-semibold', escalated && 'text-nonveg')}>
        {escalated ? 'Still not confirmed' : 'The kitchen has not confirmed this yet'}
      </p>
      <p className="mt-1 text-[0.875rem] leading-snug text-muted">
        {escalated ? (
          <>
            It has been {minutes} minutes. Please show order{' '}
            <span className="font-semibold tabular-nums text-ink">{orderNumber}</span> to a staff
            member — they can find it straight away.
          </>
        ) : (
          <>
            It has been {minutes} minutes, which is longer than usual. It may still come through —
            or you can cancel below and speak to someone.
          </>
        )}
      </p>
    </section>
  )
}

/**
 * The step indicator.
 *
 * A cancelled or rejected order is never rendered here -- progressFraction returns 0 for
 * those, and showing "60% done" on an order that will never arrive is worse than showing
 * nothing at all.
 */
function ProgressBar({ status }: { status: OrderView['status'] }) {
  const fraction = progressFraction(status)
  const reachedIndex = Math.round(fraction * DINER_PROGRESS_STEPS.length) - 1

  return (
    <div className="mt-4">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Order progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.max(fraction * 100, 6)}%` }}
        />
      </div>
      <ol className="mt-2 flex justify-between text-[0.6875rem]">
        {DINER_PROGRESS_STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              'flex-1 text-center',
              index <= reachedIndex ? 'font-semibold text-accent' : 'text-muted',
            )}
          >
            {/* Short forms: the full diner labels are sentences and will not fit five across
                a 390px viewport. */}
            {SHORT_STEP_LABEL[step] ?? step}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Short labels for the five progress steps.
 *
 * Typed as a Partial map over OrderStatus rather than over the step tuple, because
 * DINER_PROGRESS_STEPS is declared as `readonly OrderStatus[]` and its element type therefore
 * widens to every status -- including the three terminal ones, which never appear on this bar.
 * The lookup below supplies a fallback rather than asserting, so adding a step to the shared
 * constant degrades to the raw status instead of failing to compile here.
 */
const SHORT_STEP_LABEL: Partial<Record<OrderView['status'], string>> = {
  placed: 'Placed',
  accepted: 'Confirmed',
  preparing: 'Cooking',
  ready: 'Ready',
  served: 'Served',
}

function TotalRow({ label, money }: { label: string; money: OrderView['totals']['total'] }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[0.875rem] text-muted">{label}</span>
      <Money money={money} className="text-[0.875rem]" />
    </div>
  )
}
