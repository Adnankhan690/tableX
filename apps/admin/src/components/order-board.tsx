'use client'

import { isApiError } from '@tablex/api-client'
import type {
  ListOrdersQuery,
  OrderStatus,
  OrderView,
  TableInfo,
  TransitionTarget,
} from '@tablex/shared'
import { requiresReason, TRANSITION_VERB } from '@tablex/shared'
import { cn, ErrorState } from '@tablex/ui'
import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { OrderCard } from '@/components/order-card'
import { PageHeader } from '@/components/page-header'
import { ReasonDialog } from '@/components/reason-dialog'
import { Select } from '@/components/select'
import { StatsStrip } from '@/components/stats-strip'
import { EmptyState, Notice, SearchInput, Skeleton, ToggleChip, Toolbar } from '@/components/ui'
import { useAdminStream } from '@/hooks/useAdminStream'
import { api } from '@/lib/api'

/**
 * The pipeline, in kitchen order.
 *
 * No longer a set of columns -- it is the SORT KEY. The board is one list now, and the sequence a
 * ticket moves through is what orders it: an order's stage still tells a staff member what happens
 * next, so like sits with like without needing five headings to say so.
 */
const PIPELINE: readonly OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'served']

/**
 * What the status filter offers.
 *
 * Server-side, not a client-side slice of a page: `live` and repeated `status` are both real query
 * parameters (types.RequestListOrders), so asking for one stage fetches that stage rather than
 * paging through everything and hiding most of it.
 *
 * The default is `live` -- every non-terminal state. That is the shift's work: nothing completed,
 * cancelled or rejected, because none of those need anyone to do anything.
 */
const FILTERS = [
  { value: 'open', label: 'Open orders', statuses: PIPELINE, live: true },
  { value: 'placed', label: 'New', statuses: ['placed'] },
  { value: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { value: 'preparing', label: 'Preparing', statuses: ['preparing'] },
  { value: 'ready', label: 'Ready', statuses: ['ready'] },
  { value: 'served', label: 'Served', statuses: ['served'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'closed', label: 'Cancelled or rejected', statuses: ['cancelled', 'rejected'] },
  { value: 'all', label: 'All orders', statuses: [] },
] as const satisfies readonly {
  value: string
  label: string
  statuses: readonly OrderStatus[]
  live?: boolean
}[]

/** How many orders one request may return when the filter is not the live shorthand. */
const PAGE_SIZE = 50

type FilterValue = (typeof FILTERS)[number]['value']

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

  const [statusFilter, setStatusFilter] = useState<FilterValue>('open')
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
      const selected = FILTERS.find((f) => f.value === statusFilter) ?? FILTERS[0]
      // `live` is the server's own shorthand for every non-terminal state, so the default view is
      // one flag rather than a list of five. Everything else asks for its statuses by name, and
      // "All orders" asks for nothing and takes a page.
      const scope: ListOrdersQuery =
        'live' in selected && selected.live
          ? { live: true }
          : selected.statuses.length > 0
            ? { status: [...selected.statuses], per_page: PAGE_SIZE }
            : { per_page: PAGE_SIZE }
      api
        .listOrders(token, {
          ...scope,
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
  }, [getToken, statusFilter, tableFilter, search, unpaidOnly])

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

  /**
   * The list, sorted by where each ticket is in the pipeline and then by how long it has waited.
   *
   * This is what replaced five columns. The columns encoded the stage by POSITION, which cost a
   * whole axis of layout and broke apart below xl; a status badge on the card says the same thing,
   * and sorting by stage keeps like with like so the list still reads as a workflow. Within a
   * stage, oldest first: the ticket that has waited longest is the one that needs attention.
   */
  const sorted = useMemo(() => {
    const rank = (status: OrderStatus) => {
      const index = PIPELINE.indexOf(status)
      // Terminal states sort after every live one, so an "All orders" view still opens on work.
      return index === -1 ? PIPELINE.length : index
    }
    return [...(orders ?? [])].sort((a, b) => {
      const byStage = rank(a.status) - rank(b.status)
      if (byStage !== 0) return byStage
      return Date.parse(a.placed_at) - Date.parse(b.placed_at)
    })
  }, [orders])

  /**
   * How many of the loaded orders sit in each stage.
   *
   * Shown on the filter's own options, which is where the five column headings' counts went: the
   * dropdown doubles as the summary of what is on the board.
   */
  const counts = useMemo(() => {
    const tally = new Map<OrderStatus, number>()
    for (const order of orders ?? []) tally.set(order.status, (tally.get(order.status) ?? 0) + 1)
    return tally
  }, [orders])

  const filterOptions = useMemo(
    () =>
      FILTERS.map((filter) => {
        // A count is only honest for the view currently loaded -- asking for "New" fetches only
        // placed orders, so it cannot also say how many are Ready. Counts therefore appear on the
        // option only while the loaded set actually covers that stage.
        const covered =
          statusFilter === 'all' ||
          (statusFilter === 'open' && PIPELINE.includes(filter.statuses[0] as OrderStatus))
        const total = filter.statuses.reduce((n, status) => n + (counts.get(status) ?? 0), 0)
        return {
          value: filter.value,
          label:
            covered && filter.value !== 'open' && filter.value !== 'all'
              ? `${filter.label} · ${total}`
              : filter.label,
        }
      }),
    [counts, statusFilter],
  )

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
        subtitle={
          orders === null
            ? undefined
            : `${FILTERS.find((f) => f.value === statusFilter)?.label ?? 'Orders'} · ${
                orders.length
              } on the board`
        }
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
        {/* The status filter comes first: it decides what the list IS, where the other three
            narrow it. */}
        <Select
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as FilterValue)}
          options={filterOptions}
          ariaLabel="Filter by status"
          className="min-w-[12rem]"
        />
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Order number or customer"
          label="Search orders"
          className="min-w-[12rem]"
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
          /* Skeletons shaped like the list rather than a centred spinner: the layout does not jump
             when the first refresh lands, and on a board that refetches every few seconds that is
             the difference between a calm screen and a flickering one. */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            // Calm, not alarming. An empty board during a quiet hour is the normal state, and
            // copy that reads like a failure would train staff to distrust it.
            title={
              search.trim() !== '' || tableFilter !== '' || unpaidOnly
                ? 'No orders match these filters'
                : statusFilter === 'open'
                  ? 'No open orders'
                  : 'Nothing here'
            }
            description={
              search.trim() !== '' || tableFilter !== '' || unpaidOnly
                ? 'Clear the search, the table or the unpaid filter to see the rest.'
                : statusFilter === 'open'
                  ? 'New orders appear here the moment a diner places one.'
                  : 'Try a different status from the filter above.'
            }
            icon={Inbox}
          />
        ) : (
          /*
            ONE LIST, not five columns.

            The grid grows with the viewport instead of being one column per stage, which is what
            broke below xl: five columns wrapped into a 2-up zigzag that put a stage heading under
            the previous stage's cards. Stage now lives on the card, as a badge, and in the sort --
            so the same information survives at every width, and a tablet in portrait gets a
            single readable column instead of a scrambled grid.
          */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sorted.map((order) => (
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
