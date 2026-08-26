'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderStatus, OrderView, TableInfo, TransitionTarget } from '@tablex/shared'
import { requiresReason, STAFF_STATUS_LABEL, TRANSITION_VERB } from '@tablex/shared'
import { cn, EmptyState, ErrorState, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { OrderCard } from '@/components/order-card'
import { PageHeader } from '@/components/page-header'
import { ReasonDialog } from '@/components/reason-dialog'
import { Select } from '@/components/select'
import { StatsStrip } from '@/components/stats-strip'
import { useAdminStream } from '@/hooks/useAdminStream'
import { api } from '@/lib/api'

/** The live board's columns, in kitchen order. */
const COLUMNS: readonly OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'served']

/** A pending transition that is waiting on a reason from the dialog. */
interface PendingReason {
  orderUid: string
  target: TransitionTarget
}

/**
 * The order queue (PRD 6.6). This is what is on screen during service.
 */
export function OrderBoard() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [orders, setOrders] = useState<OrderView[] | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingReason | null>(null)

  const [showClosed, setShowClosed] = useState(false)
  const [tableFilter, setTableFilter] = useState('')
  const [search, setSearch] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)

  /**
   * A clock ticking once a second, so age escalation advances on its own.
   *
   * Held here rather than inside each card: one interval for the whole board instead of one per
   * order, which on a busy night is the difference between one timer and forty.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .listOrders(token, {
          // The kitchen's only real question, and the default view.
          ...(showClosed ? { per_page: 50 } : { live: true }),
          ...(tableFilter ? { table_uid: tableFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(unpaidOnly ? { payment_status: 'pending' as const } : {}),
        })
        .then((result) => {
          setOrders(result.orders)
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken, showClosed, tableFilter, search, unpaidOnly])

  useEffect(() => {
    load()
  }, [load])

  // Tables are fetched once, for the filter dropdown; they change rarely.
  useEffect(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .listTables(token)
        .then((result) => setTables(result.tables))
        .catch(() => setTables([]))
    })
  }, [getToken])

  const { live } = useAdminStream(auth?.accessToken ?? null, load)

  /** Applies a transition, or opens the reason dialog when the server will demand one. */
  const transition = useCallback(
    (order: OrderView, target: TransitionTarget, reason?: string) => {
      if (requiresReason(target) && !reason) {
        // Asked for up front rather than after a rejected submit: the server refuses these
        // without a reason, and collecting it afterwards makes the staff member do it twice.
        setPending({ orderUid: order.uid, target })
        return
      }

      setBusyUid(order.uid)
      setNotice(null)

      getToken().then((token) => {
        if (!token) {
          setBusyUid(null)
          return
        }
        api
          .transitionOrder(token, order.uid, {
            status: target,
            ...(reason ? { reason } : {}),
          })
          .then(() => {
            setBusyUid(null)
            load()
          })
          .catch((err: unknown) => {
            setBusyUid(null)

            /**
             * A 409 is another device having got there first -- two staff phones tapping Accept in
             * the same second (docs/DECISIONS.md D1). It is expected, not an error: refetch, note
             * it briefly, and let the buttons re-render from the server's new answer.
             */
            if (isApiError(err) && err.isStale) {
              setNotice(`Order ${order.order_number} was already updated on another device.`)
              load()
              return
            }
            setNotice(isApiError(err) ? err.message : 'Could not update the order.')
          })
      })
    },
    [getToken, load],
  )

  const grouped = useMemo(() => {
    const buckets = new Map<OrderStatus, OrderView[]>()
    for (const status of COLUMNS) buckets.set(status, [])
    const closed: OrderView[] = []

    for (const order of orders ?? []) {
      const bucket = buckets.get(order.status)
      if (bucket) bucket.push(order)
      else closed.push(order)
    }
    return { buckets, closed }
  }, [orders])

  /**
   * The table filter's options.
   *
   * Sorted here rather than taken in API order, which is by label as a string: that puts T-10
   * between T-1 and T-2, and a floor numbered past nine reads as scrambled. The numeric tail is
   * compared as a number so T-2 precedes T-10, and labels with no number ("Patio 1") fall back
   * to a plain comparison and sort after.
   */
  const tableOptions = useMemo(
    () => [
      { value: '', label: 'All tables' },
      ...[...tables]
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        .map((table) => ({ value: table.uid, label: `Table ${table.label}` })),
    ],
    [tables],
  )

  if (auth === null) return null

  const pendingOrder = pending ? (orders ?? []).find((o) => o.uid === pending.orderUid) : undefined

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={showClosed ? 'All orders' : 'Live orders'}
        right={
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success' : 'bg-muted')}
            />
            {/* Staff need to know whether to trust this board second-by-second. Polling is still
                correct, just slower, and saying which mode it is in avoids a staff member
                assuming a stale board is an empty one. */}
            {live ? 'Live' : 'Refreshing every 5s'}
          </span>
        }
      />

      <StatsStrip />

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Order number or customer"
          aria-label="Search orders"
          className="min-h-tap min-w-[12rem] flex-1 rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
        />
        <Select
          value={tableFilter}
          onChange={setTableFilter}
          options={tableOptions}
          ariaLabel="Filter by table"
          className="min-w-[10rem]"
        />
        <Toggle label="Unpaid only" active={unpaidOnly} onClick={() => setUnpaidOnly((v) => !v)} />
        <Toggle
          label={showClosed ? 'Showing all' : 'Live only'}
          active={showClosed}
          onClick={() => setShowClosed((v) => !v)}
        />
      </div>

      {notice !== null ? (
        <p
          role="status"
          className="no-print border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      ) : null}

      <main className="p-4">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load orders.'}
            {...(isApiError(error) && error.code ? { code: error.code } : {})}
            {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
            onRetry={load}
          />
        ) : orders === null ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Spinner /> Loading orders
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            // Calm, not alarming. An empty board during a quiet hour is the normal state, and
            // copy that reads like a failure would train staff to distrust it.
            title={showClosed ? 'No orders match' : 'No live orders'}
            description={
              showClosed
                ? 'Try clearing the filters.'
                : 'New orders appear here the moment a diner places one.'
            }
          />
        ) : (
          /* Columns on a laptop, a single stacked list on a tablet in portrait. */
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map((status) => {
              const bucket = grouped.buckets.get(status) ?? []
              if (showClosed && bucket.length === 0) return null

              return (
                <section key={status} className="min-w-0">
                  <h2 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                    {STAFF_STATUS_LABEL[status]}
                    <span className="tabular-nums">{bucket.length}</span>
                  </h2>
                  <div className="space-y-2">
                    {bucket.map((order) => (
                      <OrderCard
                        key={order.uid}
                        order={order}
                        now={now}
                        busy={busyUid === order.uid}
                        onTransition={(target) => transition(order, target)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}

            {grouped.closed.length > 0 ? (
              <section className="min-w-0">
                <h2 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                  Closed
                  <span className="tabular-nums">{grouped.closed.length}</span>
                </h2>
                <div className="space-y-2">
                  {grouped.closed.map((order) => (
                    <OrderCard
                      key={order.uid}
                      order={order}
                      now={now}
                      onTransition={() => undefined}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </main>

      <ReasonDialog
        open={pending !== null}
        title={
          pending
            ? `${TRANSITION_VERB[pending.target]} order ${pendingOrder?.order_number ?? ''}`
            : ''
        }
        description="The customer sees this on their order screen, so tell them why."
        confirmLabel={pending ? TRANSITION_VERB[pending.target] : 'Confirm'}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          const order = pendingOrder
          const target = pending?.target
          setPending(null)
          if (order && target) transition(order, target, reason)
        }}
      />
    </>
  )
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-h-tap shrink-0 rounded-card border px-3 text-sm font-medium',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted',
      )}
    >
      {label}
    </button>
  )
}
