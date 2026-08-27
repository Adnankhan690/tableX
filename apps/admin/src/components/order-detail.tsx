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
import { Phone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { ReasonDialog } from '@/components/reason-dialog'
import { Badge, Button, Card, CardHeader, Field, Input, Notice } from '@/components/ui'
import { useAdminStream } from '@/hooks/useAdminStream'
import { api } from '@/lib/api'

/** One order, opened to review and act on (PRD 6.6). */
export function OrderDetail({ orderUid }: { orderUid: string }) {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState<unknown>(null)
  /**
   * What is in flight, not merely whether something is.
   *
   * One boolean used to disable Accept, Cancel, Reject, every Remove link and "Mark as paid"
   * simultaneously, with no spinner and no label change -- so pressing Accept looked identical to
   * the page breaking. 'payment' and 'item' are their own kinds because they are separate requests
   * from a transition.
   */
  const [busy, setBusy] = useState<TransitionTarget | 'payment' | 'item' | null>(null)
  /** Toned, so a failed removal does not read like a confirmation. See the board for the why. */
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null)
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
      setBusy(target)
      setNotice(null)

      getToken().then((token) => {
        if (!token) {
          setBusy(null)
          return
        }
        api
          .transitionOrder(token, orderUid, {
            status: target,
            ...(reason ? { reason } : {}),
          })
          .then((fresh) => {
            setOrder(fresh)
            setBusy(null)
          })
          .catch((err: unknown) => {
            setBusy(null)
            // Another device won. Refetch rather than error: the request was valid a moment ago.
            if (isApiError(err) && err.isStale) {
              setNotice({
                tone: 'accent',
                text: 'This order was already updated on another device.',
              })
              load()
              return
            }
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not update the order.',
            })
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
      setBusy('item')
      getToken().then((token) => {
        if (!token) {
          setBusy(null)
          return
        }
        api
          .cancelOrderItem(token, orderUid, itemUid)
          .then((fresh) => {
            setOrder(fresh)
            setBusy(null)
          })
          .catch((err: unknown) => {
            setBusy(null)
            /**
             * The server refuses to cancel the last remaining line -- an order with no items and a
             * non-zero total is incoherent. Its message is surfaced as-is rather than pre-empted
             * with a client-side rule, so there is one place that decides.
             */
            setNotice({
              tone: 'danger',
              text: isApiError(err) ? err.message : 'Could not remove the item.',
            })
          })
      })
    },
    [getToken, orderUid],
  )

  const confirmPayment = useCallback(() => {
    setBusy('payment')
    setNotice(null)
    getToken().then((token) => {
      if (!token) {
        setBusy(null)
        return
      }
      api
        .confirmPayment(token, orderUid, {
          ...(paymentRef.trim() ? { reference: paymentRef.trim() } : {}),
        })
        .then(() => {
          setConfirmingPayment(false)
          setPaymentRef('')
          setBusy(null)
          load()
        })
        .catch((err: unknown) => {
          setBusy(null)
          setNotice({
            tone: 'danger',
            text: isApiError(err) ? err.message : 'Could not record the payment.',
          })
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

  const actions = order.next_statuses ? [...order.next_statuses] : []
  const forward = actions.filter((t) => !requiresReason(t))
  const refusals = actions.filter((t) => requiresReason(t))
  const closed = /completed|cancelled|rejected/.test(order.status)

  return (
    <>
      <PageHeader
        // Back navigation belongs before the title, where it is looked for. It used to be 12px
        // underlined text wedged into the top-right corner next to the status pill -- the slot the
        // rest of the app uses for the page's primary action.
        back={{ href: '/orders', label: 'Back to board' }}
        title={`${order.order_number} · Table ${order.table_label}`}
        subtitle={`Placed ${formatElapsed(elapsedSeconds(order.placed_at))} ago`}
        meta={<StatusBadge status={order.status} audience="staff" />}
      />

      {notice !== null ? (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          {/*
            Actions come from the server's list, never a hard-coded one (docs/DECISIONS.md D1).
            Only the ORDER and the weight are ours: the forward transition is filled, the refusals
            are quiet and pushed to the right, so "Cancel" and "Reject" stop reading as two equally
            important sibling actions of "Accept".
          */}
          {actions.length > 0 ? (
            <Card className="flex flex-wrap items-center gap-2">
              {forward.map((target) => (
                <Button
                  key={target}
                  variant="primary"
                  onClick={() => transition(target)}
                  disabled={busy !== null && busy !== target}
                  loading={busy === target}
                  loadingLabel={`${TRANSITION_VERB[target]}…`}
                >
                  {TRANSITION_VERB[target]}
                </Button>
              ))}
              {refusals.length > 0 ? (
                <div className="ml-auto flex items-center gap-1.5">
                  {refusals.map((target) => (
                    <Button
                      key={target}
                      variant="danger-quiet"
                      onClick={() => transition(target)}
                      disabled={busy !== null && busy !== target}
                      loading={busy === target}
                      loadingLabel={`${TRANSITION_VERB[target]}…`}
                    >
                      {TRANSITION_VERB[target]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {order.cancel_reason ? (
            <Notice tone="danger" title="Reason given to the diner">
              {order.cancel_reason}
            </Notice>
          ) : null}

          <Card flush>
            <div className="px-4 py-3">
              <CardHeader
                title="Items"
                description={`${order.items.length} ${order.items.length === 1 ? 'line' : 'lines'} on this ticket`}
              />
            </div>
            <ul>
              {order.items.map((item) => (
                <li
                  key={item.uid}
                  className={cn(
                    // An explicit grid, not a flex row: the amount cell shares its right edge with
                    // the totals block below, which a free-flowing flex row could not do -- the
                    // item price used to end 110px left of the subtotal directly beneath it.
                    'grid grid-cols-[auto_minmax(0,1fr)_auto_5rem] items-center gap-x-3 border-t border-divider px-4 py-2.5',
                    item.status === 'cancelled' ? 'text-muted' : '',
                  )}
                >
                  <FoodTypeBadge type={item.food_type} size={13} />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'truncate text-base',
                        // Struck through, not removed: the kitchen ticket history is what explains
                        // why the total changed.
                        item.status === 'cancelled' ? 'line-through' : '',
                      )}
                    >
                      <span className="font-semibold [font-variant-numeric:tabular-nums]">
                        {item.quantity} ×
                      </span>{' '}
                      {item.name}
                    </p>
                    {item.note ? (
                      <p className="truncate text-xs italic text-muted">
                        &ldquo;{item.note}&rdquo;
                      </p>
                    ) : null}
                  </div>
                  <Money
                    money={item.total}
                    className="text-base [font-variant-numeric:tabular-nums]"
                  />
                  <div className="flex justify-end">
                    {item.status === 'active' && !closed ? (
                      <Button
                        size="sm"
                        variant="danger-quiet"
                        onClick={() => cancelItem(item.uid, item.name)}
                        disabled={busy !== null && busy !== 'item'}
                        loading={busy === 'item'}
                        loadingLabel="Removing…"
                      >
                        Remove
                      </Button>
                    ) : item.status === 'cancelled' ? (
                      <Badge tone="neutral">Removed</Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5 border-t border-line bg-bg px-4 py-3">
              <TotalRow label="Subtotal" money={order.totals.subtotal} />
              {order.totals.discount.minor > 0 ? (
                // Rendered nowhere before this, so a discounted order printed a subtotal and a
                // total that did not reconcile -- and money that does not add up is the one thing
                // an owner will not forgive.
                <TotalRow label="Discount" money={order.totals.discount} negative />
              ) : null}
              {order.totals.tax.minor > 0 ? (
                <TotalRow label="GST" money={order.totals.tax} />
              ) : null}
              {order.totals.service_charge.minor > 0 ? (
                <TotalRow label="Service charge" money={order.totals.service_charge} />
              ) : null}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-base font-semibold">Total</span>
                <Money money={order.totals.total} className="figures text-metric font-semibold" />
              </div>
            </div>
          </Card>
        </section>

        <aside className="space-y-4">
          {/* PAYMENT. Handled carefully because it is money. */}
          <Card className="space-y-3">
            <CardHeader
              title="Payment"
              description={order.payment_method === 'counter' ? 'At the counter' : 'Online (UPI)'}
              actions={
                <Badge tone={order.payment_status === 'paid' ? 'success' : 'warning'}>
                  {PAYMENT_STATUS_LABEL[order.payment_status]}
                </Badge>
              }
            />
            <p className="figures text-metric font-semibold">
              <Money money={order.totals.total} />
            </p>

            {order.payment_status === 'paid' ? (
              <p className="text-sm text-muted">Already settled — nothing to do.</p>
            ) : confirmingPayment ? (
              <div className="space-y-3">
                {/*
                  The copy is explicit about what this action means. Static UPI cannot confirm a
                  bank transfer, so this records that a HUMAN saw the money -- the same trust model
                  as cash, attributed to the signed-in user (docs/DECISIONS.md D2). Understating
                  that would make it feel like a system check it is not.
                */}
                <Notice tone="warning">
                  This records that <strong>you saw the payment arrive</strong>. It is attributed to{' '}
                  {auth.staff.name} and cannot be undone here.
                </Notice>
                <Field label="Bank reference" optional>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={paymentRef}
                      maxLength={64}
                      onChange={(event) => setPaymentRef(event.target.value)}
                      placeholder="UTR from your bank notification"
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={confirmPayment}
                    disabled={busy !== null && busy !== 'payment'}
                    loading={busy === 'payment'}
                    loadingLabel="Recording…"
                  >
                    Confirm payment
                  </Button>
                  {/* "Not now", not "Cancel": Cancel voids the order 400px up this same page, and
                      one word cannot mean both "dismiss this form" and "refuse this order". */}
                  <Button onClick={() => setConfirmingPayment(false)}>Not now</Button>
                </div>
              </div>
            ) : (
              <Button
                variant="primary"
                block
                onClick={() => setConfirmingPayment(true)}
                disabled={busy !== null}
              >
                Mark as paid
              </Button>
            )}
          </Card>

          {order.customer_name || order.customer_phone || order.note ? (
            <Card className="space-y-2">
              <CardHeader title="Customer" />
              {order.customer_name ? (
                <p className="text-base font-medium">{order.customer_name}</p>
              ) : null}
              {order.customer_phone ? (
                // A tel: link, because staff will actually call about a missing order.
                <a
                  href={`tel:${order.customer_phone}`}
                  className="inline-flex min-h-tap items-center gap-1.5 text-base font-medium text-accent hover:underline"
                >
                  <Phone aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  {order.customer_phone}
                </a>
              ) : null}
              {order.note ? (
                <p className="rounded-control border border-line bg-bg p-2.5 text-sm italic">
                  &ldquo;{order.note}&rdquo;
                </p>
              ) : null}
            </Card>
          ) : null}

          {order.timeline && order.timeline.length > 0 ? (
            <Card className="space-y-3">
              <CardHeader title="History" />
              <ol className="space-y-3">
                {order.timeline.map((event, index) => (
                  <li
                    key={`${event.status}-${event.at}-${index}`}
                    // A rail with a node per event, so the sequence reads as a sequence rather than
                    // as four unrelated lines of text.
                    className="relative border-l border-divider pl-4 last:border-l-transparent"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute -left-[3.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong"
                    />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-medium">
                        {STAFF_STATUS_LABEL[event.status]}
                      </span>
                      <time
                        dateTime={event.at}
                        className="shrink-0 text-xs text-muted [font-variant-numeric:tabular-nums]"
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
            </Card>
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

function TotalRow({
  label,
  money,
  negative = false,
}: {
  label: string
  money: OrderView['totals']['total']
  negative?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cn(
          'text-sm [font-variant-numeric:tabular-nums]',
          negative ? 'text-success' : '',
        )}
      >
        {negative ? '−' : ''}
        <Money money={money} />
      </span>
    </div>
  )
}
