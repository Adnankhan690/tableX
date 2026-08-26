'use client'

import { isApiError } from '@tablex/api-client'
import type { OrderStatus, OrderView, TableInfo, TransitionTarget } from '@tablex/shared'
import { requiresReason, STAFF_STATUS_LABEL, TRANSITION_VERB } from '@tablex/shared'
import { cn, ErrorState } from '@tablex/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { OrderCard } from '@/components/order-card'
import { PageHeader } from '@/components/page-header'
import { ReasonDialog } from '@/components/reason-dialog'
import { Select } from '@/components/select'
import { StatsStrip } from '@/components/stats-strip'
import {
  Count,
  EmptyState,
  Notice,
  SearchInput,
  Skeleton,
  ToggleChip,
  Toolbar,
} from '@/components/ui'
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
  const [busy, setBusy] = useState<{ uid: string; target: TransitionTarget } | null>(null)
  /**
   * The one message channel on this page, with a tone.
   *
   * It used to be a bare string rendered in accent-soft with role="status", so "already updated on
   * another device" -- routine, expected, harmless -- looked identical to "Could not update the
   * order". A failure that reads like a confirmation is a failure nobody acts on.
   */
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null)
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

      setBusy({ uid: order.uid, target })
      setNotice(null)

      getToken().then((token) => {
        if (!token) {
          setBusy(null)
          return
        }
        api
          .transitionOrder(token, order.uid, {
            status: target,
            ...(reason ? { reason } : {}),
          })
          .then(() => {
            setBusy(null)
            load()
          })
          .catch((err: unknown) => {
            setBusy(null)

            /**
             * A 409 is another device having got there first -- two staff phones tapping Accept in
             * the same second (docs/DECISIONS.md D1). It is expected, not an error: refetch, note
             * it briefly, and let the buttons re-render from the server's new answer.
             */
            if (isApiError(err) && err.isStale) {
              setNotice({
                tone: 'accent',
                text: `Order ${order.order_number} was already updated on another device.`,
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
        subtitle={showClosed ? 'Every order, newest first' : 'Live orders, today'}
        meta={
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                live ? 'animate-pulse-slow bg-success' : 'bg-muted',
              )}
            />
            {/* Staff need to know whether to trust this board second-by-second. Polling is still
                correct, just slower, and saying which mode it is in avoids a staff member
                assuming a stale board is an empty one. */}
            {live ? 'Live' : 'Refreshing every 5s'}
          </span>
        }
      />

      <StatsStrip />

      <Toolbar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Order number or customer"
          label="Search orders"
          className="min-w-[14rem]"
        />
        <Select
          value={tableFilter}
          onChange={setTableFilter}
          options={tableOptions}
          ariaLabel="Filter by table"
          className="min-w-[10rem]"
        />
        <ToggleChip active={unpaidOnly} onClick={() => setUnpaidOnly((v) => !v)}>
          Unpaid only
        </ToggleChip>
        <ToggleChip active={showClosed} onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? 'Showing all' : 'Live only'}
        </ToggleChip>
      </Toolbar>

      {notice !== null ? (
        <div className="no-print border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
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
          /* Skeletons shaped like the board rather than a centred spinner: the layout does not
             jump when the first refresh lands, and on a board that refetches every few seconds
             that is the difference between a calm screen and a flickering one. */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map((status) => (
              <div key={status} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-32 w-full" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            // Calm, not alarming. An empty board during a quiet hour is the normal state, and
            // copy that reads like a failure would train staff to distrust it.
            title={showClosed ? 'No orders match these filters' : 'No live orders'}
            description={
              showClosed
                ? 'Clear the search or the table filter to see the rest.'
                : 'New orders appear here the moment a diner places one.'
            }
            icon={
              <>
                <rect x="3" y="4" width="14" height="13" rx="2" strokeWidth="1.5" />
                <path d="M7 9h6M7 12.5h4" strokeWidth="1.5" strokeLinecap="round" />
              </>
            }
          />
        ) : showClosed ? (
          /*
            "Showing all" gets its own layout rather than reusing the live grid.
            The pipeline columns encode what to do next, which is meaningless for orders that are
            already finished -- and the grid put a stranded "SERVED 0" header over blank canvas.
            A flat newest-first list is what someone looking up a past order actually wants.
          */
          <div className="mx-auto grid max-w-3xl gap-2">
            <p className="text-xs text-muted">
              {orders.length} {orders.length === 1 ? 'order' : 'orders'}, newest first
            </p>
            {orders.map((order) => (
              <OrderCard
                key={order.uid}
                order={order}
                now={now}
                pending={busy?.uid === order.uid ? busy.target : null}
                onTransition={(target) => transition(order, target)}
              />
            ))}
          </div>
        ) : (
          /*
            THE PIPELINE MUST STAY MONOTONIC.

            Five columns at xl, and below that ONE full-width column per stage, stacked in pipeline
            order. The old `md:grid-cols-2 xl:grid-cols-5` wrapped into a 2-up zigzag at the 820px
            tablet target, which put the PREPARING heading directly under NEW's cards -- so a staff
            member scanning down the tablet read a stage header as a continuation of the previous
            stage, and grid row-equalising left a 360px void beside a short column. The board's one
            job is to encode what happens next by position; a zigzag destroys exactly that.
          */
          <div className="grid gap-x-3 gap-y-5 xl:grid-cols-5">
            {COLUMNS.map((status) => {
              const bucket = grouped.buckets.get(status) ?? []
              return (
                <section key={status} className="min-w-0">
                  {/* The count sits WITH its label, not pushed to the far edge of a 270px-wide
                      column where it read as belonging to the next stage along. */}
                  <h2 className="sticky top-[3.75rem] z-10 mb-2 flex items-center gap-2 bg-bg py-1 text-xs font-semibold uppercase tracking-wide text-muted xl:static">
                    {STAFF_STATUS_LABEL[status]}
                    <Count value={bucket.length} />
                  </h2>
                  {bucket.length === 0 ? (
                    <EmptyState compact title="Nothing here" className="bg-surface" />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      {bucket.map((order) => (
                        <OrderCard
                          key={order.uid}
                          order={order}
                          now={now}
                          pending={busy?.uid === order.uid ? busy.target : null}
                          onTransition={(target) => transition(order, target)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
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
