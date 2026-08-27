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

/**
 * The statuses that get a chip of their own, in the order a shift needs them.
 *
 * Chosen by what costs a restaurant money if it is missed, not by what is easiest to list:
 *
 *  - `open`      the working set, and the default. One tap back from anywhere.
 *  - `placed`    an order nobody has acknowledged yet. The most time-critical thing on the
 *                board: the diner is sitting there with no confirmation, and the board's own
 *                escalation clock (AGE_WARN_SECONDS) exists for exactly this state.
 *  - `ready`     food is plated and going cold on the pass until someone runs it.
 *  - `completed` the owner's question rather than the floor's -- "how did we do today" -- and the
 *                one archive worth a single tap.
 *
 * Accepted and Preparing are deliberately NOT chips: the kitchen is already on those, so filtering
 * to them is browsing rather than acting. Cancelled and rejected stay in the dropdown, because
 * reviewing refusals is a end-of-shift job, not a service-time one.
 */
const QUICK_FILTERS: readonly FilterValue[] = ['open', 'placed', 'ready', 'completed']

/**
 * Which chips carry a count.
 *
 * Only the queues. A badge says "this many things are waiting for you", so putting one on
 * Completed would turn a record into a demand -- and the strip above already reports the day's
 * completed total with its share of today. An archive gets a chip, not a badge.
 */
const BADGED: readonly FilterValue[] = ['open', 'placed', 'ready']

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
  /**
   * Every open order, purely to count the chips.
   *
   * The badges have to keep telling the truth after a chip is tapped, and the list itself cannot
   * do that: filtering to New leaves `orders` holding only placed ones, so a Ready badge derived
   * from it would read 0. This costs nothing in the default view -- there `orders` IS the open set,
   * so it is reused -- and one extra request per refresh only while a narrower filter is active.
   */
  const [queue, setQueue] = useState<OrderView[] | null>(null)
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
          if (selected.value === 'open') {
            setQueue(result.orders)
            return
          }
          // A narrower filter is active, so the chip counts need their own read of the open set.
          api
            .listOrders(token, { live: true, per_page: PAGE_SIZE })
            .then((open) => setQueue(open.orders))
            .catch(() => {
              /* Counts are a convenience; losing them must not disturb the board. */
            })
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
   * What each badged chip shows.
   *
   * `open` is the whole open set; the two stage chips count within it. Null while the open set has
   * not loaded, so a badge is absent rather than confidently wrong.
   */
  const chipCounts = useMemo((): Partial<Record<FilterValue, number>> => {
    if (queue === null) return {}
    return {
      open: queue.length,
      placed: queue.filter((order) => order.status === 'placed').length,
      ready: queue.filter((order) => order.status === 'ready').length,
    }
  }, [queue])

  const filterOptions = useMemo(
    // Plain labels. The counts that used to hang off these options were only honest for whichever
    // scope happened to be loaded, and the chips above now carry them from a source that stays
    // correct whatever is selected.
    () => FILTERS.map((filter) => ({ value: filter.value, label: filter.label })),
    [],
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

      {/*
        TWO ROWS, and the split is the point: the top row decides WHICH orders, the bottom row
        narrows them. Four controls wrapping in one band made "Open orders" and "All tables" sit
        side by side as if they were the same kind of thing.
      */}
      {/*
        FILTERS ON TOP, SEARCH BELOW.

        The top row decides WHICH orders and how they are narrowed; search gets its own full-width
        row underneath. Two reasons it is not squeezed in beside the filters: a search field is the
        one control whose useful width depends on what you type into it, and an order number and a
        customer name are both longer than the 12rem it was getting when four controls shared a
        band. The vertical rule splits the row into "which stage" and "narrow it down", which is the
        alignment cue that was missing when everything sat in one undifferentiated line.
      */}
      <Toolbar className="flex-col items-stretch gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            THE CHIP RAIL HOLDS ONE LINE.

            It scrolls sideways rather than wrapping: the four stages are one set, and a set that
            breaks across two lines stops reading as a set -- "Completed" alone on a second row
            looks like a different kind of control. `w-full` below lg gives it the whole line to
            scroll in; from lg it takes its natural width and shares the row with the controls that
            follow, so a wide screen still gets one tidy band instead of a stranded rail.

            The negative margin lets the scroll area span the toolbar's own padding, so a chip
            scrolls to the very edge instead of stopping short inside it.
          */}
          <div
            role="group"
            aria-label="Quick status filters"
            className="scroll-x-contain scrollbar-none -mx-4 flex w-full flex-nowrap gap-1.5 px-4 lg:mx-0 lg:w-auto lg:px-0"
          >
            {QUICK_FILTERS.map((value) => {
              const filter = FILTERS.find((f) => f.value === value)
              if (!filter) return null
              return (
                <ToggleChip
                  key={value}
                  active={statusFilter === value}
                  count={BADGED.includes(value) ? chipCounts[value] : undefined}
                  // Only the two stages that need someone to move: an unacknowledged order and
                  // food waiting on the pass. The open-orders total is a scope, not a queue.
                  countTone={value === 'placed' || value === 'ready' ? 'urgent' : 'neutral'}
                  onClick={() => setStatusFilter(value)}
                >
                  {filter.label}
                </ToggleChip>
              )
            })}
          </div>

          {/*
            The dropdown keeps every status reachable. It shows the SELECTION only when the chips do
            not already -- pick Preparing and it reads "Preparing"; pick New and the chip is lit, so
            this falls back to its placeholder instead of saying the same word twice.
          */}
          <Select
            value={QUICK_FILTERS.includes(statusFilter) ? '' : statusFilter}
            onChange={(value) => setStatusFilter(value as FilterValue)}
            options={filterOptions}
            placeholder="More statuses"
            ariaLabel="Filter by status"
            className="min-w-[10.5rem]"
          />

          {/* The boundary between choosing a stage and narrowing within it. Hidden once the row
              wraps, where a rule would fall in the middle of a line and mean nothing. */}
          <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-divider lg:block" />

          <Select
            value={tableFilter}
            onChange={setTableFilter}
            options={tableOptions}
            ariaLabel="Filter by table"
            className="min-w-[9.5rem]"
          />
          <ToggleChip active={unpaidOnly} onClick={() => setUnpaidOnly((v) => !v)}>
            Unpaid only
          </ToggleChip>
        </div>

        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search by order number or customer name"
          label="Search orders"
          className="w-full"
        />
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
