'use client'

import type { OrderStatsView } from '@tablex/shared'
import { cn } from '@tablex/ui'
import {
  Activity,
  Banknote,
  ChefHat,
  ChevronDown,
  CircleCheck,
  CircleX,
  ClipboardList,
  type LucideIcon,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { AGE_WARN_SECONDS } from '@/components/order-card'
import { Skeleton } from '@/components/ui'
import { usePolling } from '@/hooks/usePolling'
import { api } from '@/lib/api'

/**
 * Today's figures, mapped onto the PRD's success metrics (PRD 3).
 *
 * Polled slowly -- these are glanceable numbers, not something anyone watches change. The order
 * board next to it already refreshes in real time, and polling both at the same rate would
 * double the request volume for no benefit.
 */
const STATS_POLL_MS = 60_000

/**
 * The cells, in order, named once.
 *
 * Used by the loading state so the skeleton lays out exactly like the real grid -- eight cells, not
 * eight anonymous positions in an array -- and so each placeholder has a stable key.
 */
const CELL_KEYS = [
  'placed',
  'live',
  'completed',
  'cancelled',
  'revenue',
  'unpaid',
  'accept',
  'fulfil',
] as const

/**
 * Where the collapsed/expanded choice is remembered.
 *
 * It has to be remembered somewhere: the strip remounts on every navigation, so a collapse that
 * forgot itself would reopen the moment a staff member looked at the menu and came back -- a
 * control that undoes the user's decision is worse than no control.
 *
 * localStorage rather than a cookie or the URL: it is a per-device display preference, not state
 * the server or a shared link should carry.
 */
const COLLAPSE_KEY = 'tablex.admin.stats.collapsed'

/**
 * A DURATION, not a relative time.
 *
 * `formatElapsed` from packages/shared is a since-then formatter: it says "just now" under a
 * minute and "20 min" after that. Correct on an order card's clock, nonsense in an average --
 * "Avg. to accept: just now" was on screen, and "20 min" cannot be told apart from 20 minutes 59
 * seconds, which is the range an owner would quote at us. So this one is local and absolute.
 */
function formatDuration(seconds: number): string {
  if (seconds < 1) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins < 60) return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

/** A whole-number share, for the "x% of today" lines. Guarded: a quiet morning divides by zero. */
function share(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined
  return `${Math.round((part / whole) * 100)}% of today`
}

/**
 * The board filters a breakdown band can select.
 *
 * Narrower than the order board's own `FilterValue` on purpose, and declared here rather than
 * imported from there: order-board imports this file, so pulling its type back would be circular.
 * Because a function taking the wider union is assignable to one taking this narrower type, the
 * board can pass `setStatusFilter` straight in with no cast.
 *
 * Each value maps EXACTLY onto what its band counts, which is what makes the click honest:
 *   `open`      <- orders_live      = every non-terminal status (repo: NOT IN orderStatusesClosed)
 *   `completed` <- orders_completed = status completed
 *   `closed`    <- orders_cancelled = cancelled + rejected (repo: orderStatusesVoided)
 * That last one reads like an approximation and is not: the figure and the filter cover the same
 * two statuses.
 */
export type StatsFilter = 'open' | 'completed' | 'closed'

export function StatsStrip({
  /** Called when a breakdown band is clicked. Without it the bands still explain themselves. */
  onFilter,
}: {
  onFilter?: (filter: StatsFilter) => void
}) {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<OrderStatsView | null>(null)
  const [failed, setFailed] = useState(false)
  /**
   * Open by default, and read from storage AFTER mount.
   *
   * Reading localStorage in the initial state would make the server-rendered markup and the first
   * client render disagree, which React reports as a hydration error. So the first paint is always
   * the expanded state and the stored preference is applied a tick later -- and because the
   * transition is CSS on grid-template-rows, that correction animates rather than snapping.
   */
  const [expanded, setExpanded] = useState(true)
  const figuresId = useId()

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === '1') setExpanded(false)
    } catch {
      /* Private mode, or storage disabled. The default stands; this is a preference, not data. */
    }
  }, [])

  const toggle = useCallback(() => {
    setExpanded((open) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, open ? '1' : '0')
      } catch {
        /* See above -- failing to remember the preference must not stop it taking effect now. */
      }
      return !open
    })
  }, [])

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .statsToday(token)
        .then((next) => {
          setStats(next)
          setFailed(false)
        })
        .catch(() => {
          /* The board below is the important thing on this page; a missing stat strip must not
             take it down. It says so rather than showing stale or blank figures. */
          setFailed(true)
        })
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])
  usePolling(load, STATS_POLL_MS)

  if (failed && stats === null) {
    return (
      <div className="no-print border-b border-line bg-surface px-4 py-2.5 text-xs text-muted">
        Today&rsquo;s figures are unavailable. The board below is unaffected.
      </div>
    )
  }

  /**
   * Whether the kitchen is accepting orders inside the board's own escalation threshold.
   *
   * AGE_WARN_SECONDS is where an order card starts tinting -- so it is already this product's
   * statement about how long a diner should wait to be acknowledged. Reusing it means the tile
   * says "we are inside the promise" rather than reporting a number with nothing to compare it to.
   */
  const acceptSecs = stats?.avg_accept_secs ?? null
  const acceptOnTarget = acceptSecs !== null ? acceptSecs <= AGE_WARN_SECONDS : null

  return (
    <section aria-label="Today's figures" className="no-print border-b border-line bg-surface">
      {/*
        The header is the toggle, and it keeps the two actionable figures when shut.

        Collapsing must not blind anyone: work in progress and money not yet collected are the two
        numbers a staff member would notice from the doorway, so they ride the header rather than
        disappearing with the rest. Everything else is a record that can wait for a click.
      */}
      <h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={figuresId}
          onClick={toggle}
          className="flex min-h-tap w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-bg"
        >
          {/*
            The scope is stated ONCE, here, instead of in three of the eight labels. "Placed today"
            and "Live now" sat side by side above a board showing four live orders, so the strip
            appeared to contradict the thing directly beneath it.
          */}
          <span className="text-xs font-semibold text-ink">Today</span>

          {!expanded && stats !== null ? (
            <span className="flex flex-wrap items-center gap-x-3 text-xs">
              <span className={stats.orders_live > 0 ? 'font-medium text-accent' : 'text-muted'}>
                {stats.orders_live} live
              </span>
              <span
                className={
                  stats.unpaid_amount.minor > 0 ? 'font-medium text-warning' : 'text-muted'
                }
              >
                {stats.unpaid_amount.display} unpaid
              </span>
            </span>
          ) : null}

          <span className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-faint sm:inline">
              {expanded ? 'Since midnight, in the restaurant’s timezone' : 'Show today’s figures'}
            </span>
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cn(
                'h-4 w-4 shrink-0 text-muted transition-transform duration-300 motion-reduce:transition-none',
                expanded ? 'rotate-180' : '',
              )}
            />
          </span>
        </button>
      </h2>

      {/*
        A HAIRLINE CELL GRID.

        `gap-px` over a divider-coloured background, with each cell painting itself `bg-surface`:
        the gaps ARE the rules. It survives wrapping at any column count, which a per-cell
        `border-l` does not -- that draws a stray line at the start of every wrapped row.

        Eight cells: one row at xl, two of four at sm, four of two on a phone. The cells give the
        figures a shared baseline grid, which is what was missing when they floated as loose text.
      */}
      {/*
        THE COLLAPSE IS PURE CSS -- the same mechanism as the order card.

        A grid whose single row goes from `0fr` to `1fr` transitions to the content's own height,
        which `height: auto` cannot do: no measuring, no ResizeObserver, and nothing for a board
        that re-renders every second to fight with. `overflow-hidden` clips during the transition
        and the inner `min-h-0` is what lets the row actually reach zero -- without it the child's
        min-content height holds it open.
      */}
      <div
        id={figuresId}
        role="region"
        aria-label="Today's figures in detail"
        className={cn(
          'grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out',
          'motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          <dl className="grid grid-cols-2 gap-px border-t border-divider bg-divider sm:grid-cols-4 xl:grid-cols-8">
            {stats === null
              ? CELL_KEYS.map((key) => (
                  <div key={key} className="space-y-2 bg-surface px-4 py-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-14" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                ))
              : [
                  <Cell
                    key="placed"
                    icon={ClipboardList}
                    label="Placed"
                    value={String(stats.orders_placed)}
                    context="Orders taken"
                    // The one composition worth drawing: placed is exactly live + completed +
                    // cancelled, so the bar is a true breakdown rather than a decorative sparkline of
                    // data this endpoint does not return.
                    breakdown={
                      stats.orders_placed > 0
                        ? [
                            {
                              label: 'Live',
                              value: stats.orders_live,
                              className: 'bg-accent',
                              textClassName: 'text-accent',
                              filter: 'open',
                            },
                            {
                              label: 'Completed',
                              value: stats.orders_completed,
                              className: 'bg-success',
                              textClassName: 'text-success',
                              filter: 'completed',
                            },
                            {
                              label: 'Cancelled',
                              value: stats.orders_cancelled,
                              className: 'bg-danger',
                              textClassName: 'text-danger',
                              filter: 'closed',
                            },
                          ]
                        : undefined
                    }
                    onFilter={onFilter}
                  />,
                  <Cell
                    key="live"
                    icon={Activity}
                    label="Live"
                    value={String(stats.orders_live)}
                    context={share(stats.orders_live, stats.orders_placed)}
                    // The one figure on the strip that is a call to action rather than a record.
                    tone={stats.orders_live > 0 ? 'accent' : undefined}
                  />,
                  <Cell
                    key="completed"
                    icon={CircleCheck}
                    label="Completed"
                    value={String(stats.orders_completed)}
                    context={share(stats.orders_completed, stats.orders_placed)}
                  />,
                  <Cell
                    key="cancelled"
                    icon={CircleX}
                    label="Cancelled"
                    value={String(stats.orders_cancelled)}
                    context={share(stats.orders_cancelled, stats.orders_placed)}
                  />,
                  <Cell
                    key="revenue"
                    icon={Banknote}
                    label="Revenue"
                    value={stats.revenue.display}
                    // Precisely what the server sums: paid orders only, whatever their status.
                    context="Collected"
                  />,
                  <Cell
                    key="unpaid"
                    icon={TriangleAlert}
                    label="Unpaid"
                    value={stats.unpaid_amount.display}
                    // Also precise: pending payment on orders that are still open.
                    context="On open orders"
                    // Money nobody has collected yet -- the figure an owner would want to see from
                    // the doorway.
                    tone={stats.unpaid_amount.minor > 0 ? 'warning' : undefined}
                  />,
                  <Cell
                    key="accept"
                    icon={Timer}
                    label="Avg. to accept"
                    // An em dash, never "0s". A zero would claim orders are accepted instantly, which
                    // is a different and false statement.
                    value={acceptSecs !== null ? formatDuration(acceptSecs) : '—'}
                    // Kept short deliberately: at eight columns a cell is ~180px, and a context line
                    // that truncates tells the reader less than no context line at all.
                    context={
                      acceptOnTarget === null
                        ? `Target ${AGE_WARN_SECONDS / 60} min`
                        : acceptOnTarget
                          ? `On target (${AGE_WARN_SECONDS / 60} min)`
                          : `Over target (${AGE_WARN_SECONDS / 60} min)`
                    }
                    tone={acceptOnTarget === false ? 'warning' : undefined}
                    contextTone={
                      acceptOnTarget === true
                        ? 'success'
                        : acceptOnTarget === false
                          ? 'warning'
                          : undefined
                    }
                  />,
                  <Cell
                    key="fulfil"
                    icon={ChefHat}
                    label="Avg. to complete"
                    value={
                      stats.avg_fulfil_secs != null ? formatDuration(stats.avg_fulfil_secs) : '—'
                    }
                    context="Placed → done"
                  />,
                ]}
          </dl>
        </div>
      </div>
    </section>
  )
}

interface BreakdownSegment {
  /**
   * What this slice is.
   *
   * Required, because a colour is not a label. The bar drew three unexplained bands and the only
   * way to learn that blue meant live was to already know.
   */
  label: string
  value: number
  /** Fill for the band. */
  className: string
  /** The board filter this band selects when clicked. Omit for a band with no equivalent. */
  filter?: StatsFilter
  /**
   * Text colour for the read-out below.
   *
   * Carried alongside the fill rather than derived from it: the read-out appears in the same colour
   * as the band being pointed at, which is what makes the mapping obvious without a legend.
   */
  textClassName: string
}

/**
 * One figure: label with its icon, the value, and one line of context.
 *
 * The context line is the part that was missing. Eight bare numbers make a reader do the
 * arithmetic -- is 3 live a lot? is ₹1,470 unpaid bad? -- so each cell now states what its number
 * is a share of, or what it is measured between. Nothing here needs an API change: every context
 * string is either derived from the figures already returned or a definition of the figure itself.
 */
function Cell({
  icon: Icon,
  label,
  value,
  context,
  tone,
  contextTone,
  breakdown,
  onFilter,
}: {
  icon: LucideIcon
  label: string
  value: string
  context?: string
  tone?: 'accent' | 'warning'
  contextTone?: 'success' | 'warning'
  breakdown?: BreakdownSegment[]
  onFilter?: (filter: StatsFilter) => void
}) {
  const total = breakdown?.reduce((n, segment) => n + segment.value, 0) ?? 0
  /**
   * Which band is being pointed at, or null.
   *
   * One value again. A previous version also latched on tap, because tapping was the only way to
   * read a band on a touch screen -- a tap now SELECTS the band's filter instead, and the list
   * redrawing underneath is better feedback than a line of text. Nothing needs to survive
   * `pointerleave` any more.
   */
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered !== null ? breakdown?.[hovered] : undefined

  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <Icon
          aria-hidden="true"
          // Lucide defaults to 2px at 24px; at 14px that reads heavy next to 12px text.
          strokeWidth={1.75}
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-faint',
          )}
        />
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cn(
          'figures mt-1 truncate text-metric font-semibold',
          tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-ink',
        )}
      >
        {value}
      </dd>

      {breakdown && total > 0 ? (
        /*
          NO LONGER `aria-hidden`. It was decorative because it was unreadable -- three colours and
          nothing saying what they were. Each band is now a button carrying its own name and share,
          so the composition is available by pointer, by keyboard and to a screen reader.

          Three extra tab stops, and only three: `placed` is the one cell in the strip with a
          breakdown, so this does not multiply across the row.

          `h-2` rather than `h-1`. Doubling a 4px bar is still a slim rule, and 4px was not a
          pointer target at all -- let alone a finger one.
        */
        <div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-surface-sunken">
          {breakdown.map((segment, index) =>
            segment.value > 0 ? (
              <button
                key={segment.label}
                type="button"
                className={cn(
                  segment.className,
                  'h-full transition-opacity',
                  // Only the bands that lead somewhere say so. A band with no `filter` still
                  // explains itself on hover, so it stays a button -- it just is not a link.
                  segment.filter && onFilter ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                )}
                // A percentage width, so the bar is a proportion and not a count of pixels.
                style={{ width: `${(segment.value / total) * 100}%` }}
                onClick={() => {
                  if (segment.filter) onFilter?.(segment.filter)
                }}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                /* The label states the FIGURE and, where there is one, the ACTION -- a bare
                   "Cancelled: 3 of 24" would not tell a screen-reader user that this is a
                   control rather than a readout. */
                aria-label={
                  segment.filter && onFilter
                    ? `${segment.label}: ${segment.value} of ${total} ${label.toLowerCase()}. Show these orders.`
                    : `${segment.label}: ${segment.value} of ${total} ${label.toLowerCase()}`
                }
              />
            ) : null,
          )}
        </div>
      ) : null}

      {/*
        THE READ-OUT SHARES THE CONTEXT LINE, rather than floating above the bar as a tooltip.

        Not a stylistic preference -- the collapse wrapper above is `overflow-hidden` (it has to be,
        for the grid-rows transition), so anything positioned outside this cell gets clipped. Using
        a line that already exists also means no layout shift when it appears, and it cannot escape
        a 2-column-on-mobile cell and run off the strip.

        In the band's own colour, which is what ties the words to the swatch under the pointer.
      */}
      {shown || context ? (
        <p
          className={cn(
            'mt-1.5 truncate text-xs',
            shown
              ? cn('font-medium', shown.textClassName)
              : contextTone === 'success'
                ? 'text-success'
                : contextTone === 'warning'
                  ? 'text-warning'
                  : 'text-faint',
          )}
        >
          {shown
            ? `${shown.label} · ${shown.value} (${Math.round((shown.value / total) * 100)}%)`
            : context}
        </p>
      ) : null}
    </div>
  )
}
