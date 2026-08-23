'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderView, TransitionTarget } from '@tablex/shared'
import {
  elapsedSeconds,
  formatElapsed,
  PAYMENT_STATUS_LABEL,
  requiresReason,
  STAFF_STATUS_LABEL,
  TRANSITION_VERB,
} from '@tablex/shared'
import { cn, ErrorState, FoodTypeBadge, Money, Spinner, StatusBadge } from '@tablex/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { ReasonDialog } from '@/components/reason-dialog'
import { useAdminStream } from '@/hooks/useAdminStream'
import { api } from '@/lib/api'

/** One order, opened to review and act on (PRD 6.6). */
export function OrderDetail({ orderUid }: { orderUid: string }) {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<TransitionTarget | null>(null)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [paymentRef, setPaymentRef] = useState('')

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .getOrder(token, orderUid)
        .then((fresh) => {
          setOrder(fresh)
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken, orderUid])

  useEffect(() => {
    load()
  }, [load])
  useAdminStream(auth?.accessToken ?? null, load)

  const transition = useCallback(
    (target: TransitionTarget, reason?: string) => {
      if (requiresReason(target) && !reason) {
        setPendingTarget(target)
        return
      }
      setBusy(true)
      setNotice(null)

      getToken().then((token) => {
        if (!token) {
          setBusy(false)
          return
        }
        api
          .transitionOrder(token, orderUid, {
            status: target,
            ...(reason ? { reason } : {}),
          })
          .then((fresh) => {
            setOrder(fresh)
            setBusy(false)
          })
          .catch((err: unknown) => {
            setBusy(false)
            // Another device won. Refetch rather than error: the request was valid a moment ago.
            if (isApiError(err) && err.isStale) {
              setNotice('This order was already updated on another device.')
              load()
              return
            }
            setNotice(isApiError(err) ? err.message : 'Could not update the order.')
          })
      })
    },
    [getToken, orderUid, load],
  )

  const cancelItem = useCallback(
    (itemUid: string, itemName: string) => {
      // A native confirm rather than a dialog component: this is destructive but not
      // reason-bearing, and the server is the authority on whether it is even allowed.
      if (!window.confirm(`Remove ${itemName} from this order? The total will be recalculated.`)) {
        return
      }
      setBusy(true)
      getToken().then((token) => {
        if (!token) {
          setBusy(false)
          return
        }
        api
          .cancelOrderItem(token, orderUid, itemUid)
          .then((fresh) => {
            setOrder(fresh)
            setBusy(false)
          })
          .catch((err: unknown) => {
            setBusy(false)
            /**
             * The server refuses to cancel the last remaining line -- an order with no items and a
             * non-zero total is incoherent. Its message is surfaced as-is rather than pre-empted
             * with a client-side rule, so there is one place that decides.
             */
            setNotice(isApiError(err) ? err.message : 'Could not remove the item.')
          })
      })
    },
    [getToken, orderUid],
  )

  const confirmPayment = useCallback(() => {
    setBusy(true)
    setNotice(null)
    getToken().then((token) => {
      if (!token) {
        setBusy(false)
        return
      }
      api
        .confirmPayment(token, orderUid, {
          ...(paymentRef.trim() ? { reference: paymentRef.trim() } : {}),
        })
        .then(() => {
          setConfirmingPayment(false)
          setPaymentRef('')
          setBusy(false)
          load()
        })
        .catch((err: unknown) => {
          setBusy(false)
          setNotice(isApiError(err) ? err.message : 'Could not record the payment.')
        })
    })
  }, [getToken, orderUid, paymentRef, load])

  if (auth === null) return null

  if (error !== null && order === null) {
    return (
      <>
        <PageHeader title="Order" />
        <ErrorState
          message={isApiError(error) ? error.message : 'Could not load this order.'}
          {...(isApiError(error) && error.code ? { code: error.code } : {})}
          {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
          onRetry={load}
        />
      </>
    )
  }

  if (order === null) {
    return (
      <>
        <PageHeader title="Order" />
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Spinner /> Loading
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={`${order.order_number} · Table ${order.table_label}`}
        subtitle={`Placed ${formatElapsed(elapsedSeconds(order.placed_at))} ago`}
        right={
          <>
            <StatusBadge status={order.status} audience="staff" />
            <Link href="/orders" className="text-xs font-medium text-accent underline">
              Back to board
            </Link>
          </>
        }
      />

      {notice !== null ? (
        <p
          role="status"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      ) : null}

      <main className="grid gap-4 p-4 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          {/* Actions from the server's list, never a hard-coded one (docs/DECISIONS.md D1). */}
          {order.next_statuses && order.next_statuses.length > 0 ? (
            <div className="flex flex-wrap gap-2 rounded-card border border-line bg-surface p-3">
              {order.next_statuses.map((target) => (
                <button
                  key={target}
                  type="button"
                  disabled={busy}
                  onClick={() => transition(target)}
                  className={cn(
                    'min-h-tap rounded-card px-4 text-sm font-semibold disabled:opacity-40',
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

          {order.cancel_reason ? (
            <p className="rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger">
              {order.cancel_reason}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Items
            </h2>
            <ul>
              {order.items.map((item) => (
                <li
                  key={item.uid}
                  className={cn(
                    'flex items-start gap-2 border-b border-line px-4 py-2.5 last:border-b-0',
                    // Struck through, not removed: the kitchen ticket history is what explains
                    // why the total changed.
                    item.status === 'cancelled' && 'text-muted line-through',
                  )}
                >
                  <FoodTypeBadge type={item.food_type} size={13} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold tabular-nums">{item.quantity} ×</span>{' '}
                      {item.name}
                    </p>
                    {item.note ? <p className="text-xs italic text-muted">“{item.note}”</p> : null}
                  </div>
                  <Money money={item.total} className="text-sm" />
                  {item.status === 'active' &&
                  !order.status.match(/completed|cancelled|rejected/) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => cancelItem(item.uid, item.name)}
                      className="shrink-0 text-xs font-medium text-danger underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="space-y-1 border-t border-line px-4 py-3">
              <TotalRow label="Subtotal" money={order.totals.subtotal} />
              {order.totals.tax.minor > 0 ? (
                <TotalRow label="GST" money={order.totals.tax} />
              ) : null}
              {order.totals.service_charge.minor > 0 ? (
                <TotalRow label="Service charge" money={order.totals.service_charge} />
              ) : null}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-sm font-semibold">Total</span>
                <Money money={order.totals.total} className="text-sm font-semibold" />
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          {/* PAYMENT. Handled carefully because it is money. */}
          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Payment</h2>
            <p className="mt-2 text-sm">
              {order.payment_method === 'counter' ? 'At the counter' : 'Online (UPI)'}
              <span className="mx-1.5 text-muted">·</span>
              <span
                className={
                  order.payment_status === 'paid' ? 'font-semibold text-success' : 'text-muted'
                }
              >
                {PAYMENT_STATUS_LABEL[order.payment_status]}
              </span>
            </p>
            <p className="mt-1 text-sm">
              <Money money={order.totals.total} className="font-semibold" />
            </p>

            {order.payment_status === 'paid' ? (
              <p className="mt-2 text-xs text-muted">Already settled — nothing to do.</p>
            ) : confirmingPayment ? (
              <div className="mt-3 space-y-2">
                {/*
                  The copy is explicit about what this action means. Static UPI cannot confirm a
                  bank transfer, so this records that a HUMAN saw the money -- the same trust model
                  as cash, attributed to the signed-in user (docs/DECISIONS.md D2). Understating
                  that would make it feel like a system check it is not.
                */}
                <p className="text-xs leading-snug text-muted">
                  This records that <strong>you saw the payment arrive</strong>. It is attributed to{' '}
                  {auth.staff.name} and cannot be undone here.
                </p>
                <label className="block">
                  <span className="text-xs font-medium">Bank reference (optional)</span>
                  <input
                    value={paymentRef}
                    maxLength={64}
                    onChange={(event) => setPaymentRef(event.target.value)}
                    placeholder="UTR from your bank notification"
                    className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-2 text-sm outline-none focus:border-accent"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={confirmPayment}
                    className="min-h-tap flex-1 rounded-card bg-success px-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {busy ? 'Recording…' : 'Confirm payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingPayment(false)}
                    className="min-h-tap rounded-card border border-line px-3 text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingPayment(true)}
                className="mt-3 min-h-tap w-full rounded-card border border-success px-3 text-sm font-semibold text-success disabled:opacity-40"
              >
                Mark as paid
              </button>
            )}
          </div>

          {order.customer_name || order.customer_phone || order.note ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Customer</h2>
              {order.customer_name ? <p className="mt-2 text-sm">{order.customer_name}</p> : null}
              {order.customer_phone ? (
                // A tel: link, because staff will actually call about a missing order.
                <a
                  href={`tel:${order.customer_phone}`}
                  className="mt-0.5 block text-sm font-medium text-accent"
                >
                  {order.customer_phone}
                </a>
              ) : null}
              {order.note ? (
                <p className="mt-2 rounded bg-surface-sunken p-2 text-sm italic">“{order.note}”</p>
              ) : null}
            </div>
          ) : null}

          {order.timeline && order.timeline.length > 0 ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">History</h2>
              <ol className="mt-2 space-y-1.5">
                {order.timeline.map((event, index) => (
                  <li key={`${event.status}-${event.at}-${index}`} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span>{STAFF_STATUS_LABEL[event.status]}</span>
                      <time
                        dateTime={event.at}
                        className="shrink-0 text-xs tabular-nums text-muted"
                      >
                        {new Date(event.at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    {/* The actor is shown so "who cancelled table 7's order" is answerable. */}
                    <p className="text-xs text-muted">
                      by {event.actor_type}
                      {event.note ? ` — ${event.note}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </aside>
      </main>

      <ReasonDialog
        open={pendingTarget !== null}
        title={pendingTarget ? `${TRANSITION_VERB[pendingTarget]} order ${order.order_number}` : ''}
        description="The customer sees this on their order screen, so tell them why."
        confirmLabel={pendingTarget ? TRANSITION_VERB[pendingTarget] : 'Confirm'}
        onCancel={() => setPendingTarget(null)}
        onConfirm={(reason) => {
          const target = pendingTarget
          setPendingTarget(null)
          if (target) transition(target, reason)
        }}
      />
    </>
  )
}

function TotalRow({ label, money }: { label: string; money: OrderView['totals']['total'] }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted">{label}</span>
      <Money money={money} className="text-sm" />
    </div>
  )
}
