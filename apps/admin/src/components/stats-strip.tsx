'use client'

import type { OrderStatsView } from '@tablex/shared'
import { cn } from '@tablex/ui'
import {
  Activity,
  Banknote,
  ChefHat,
  CircleCheck,
  CircleX,
  ClipboardList,
  type LucideIcon,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

export function StatsStrip() {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<OrderStatsView | null>(null)
  const [failed, setFailed] = useState(false)

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
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        {/*
          The scope is stated ONCE, here, instead of in three of the eight labels. "Placed today"
          and "Live now" sat side by side above a board showing four live orders, so the strip
          appeared to contradict the thing directly beneath it.
        */}
        <h2 className="text-xs font-semibold text-ink">Today</h2>
        <p className="text-xs text-faint">Since midnight, in the restaurant&rsquo;s timezone</p>
      </div>

      {/*
        A HAIRLINE CELL GRID.

        `gap-px` over a divider-coloured background, with each cell painting itself `bg-surface`:
        the gaps ARE the rules. It survives wrapping at any column count, which a per-cell
        `border-l` does not -- that draws a stray line at the start of every wrapped row.

        Eight cells: one row at xl, two of four at sm, four of two on a phone. The cells give the
        figures a shared baseline grid, which is what was missing when they floated as loose text.
      */}
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
                        { value: stats.orders_live, className: 'bg-accent' },
                        { value: stats.orders_completed, className: 'bg-success' },
                        { value: stats.orders_cancelled, className: 'bg-danger' },
                      ]
                    : undefined
                }
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
                value={stats.avg_fulfil_secs != null ? formatDuration(stats.avg_fulfil_secs) : '—'}
                context="Placed → done"
              />,
            ]}
      </dl>
    </section>
  )
}

interface BreakdownSegment {
  value: number
  className: string
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
}: {
  icon: LucideIcon
  label: string
  value: string
  context?: string
  tone?: 'accent' | 'warning'
  contextTone?: 'success' | 'warning'
  breakdown?: BreakdownSegment[]
}) {
  const total = breakdown?.reduce((n, segment) => n + segment.value, 0) ?? 0
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
          'mt-1 truncate text-metric font-semibold [font-variant-numeric:tabular-nums]',
          tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-ink',
        )}
      >
        {value}
      </dd>

      {breakdown && total > 0 ? (
        <div
          aria-hidden="true"
          className="mt-2 flex h-1 gap-px overflow-hidden rounded-full bg-surface-sunken"
        >
          {breakdown.map((segment) =>
            segment.value > 0 ? (
              <span
                key={segment.className}
                className={segment.className}
                // A percentage width, so the bar is a proportion and not a count of pixels.
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ) : null,
          )}
        </div>
      ) : null}

      {context ? (
        <p
          className={cn(
            'mt-1.5 truncate text-xs',
            contextTone === 'success'
              ? 'text-success'
              : contextTone === 'warning'
                ? 'text-warning'
                : 'text-faint',
          )}
        >
          {context}
        </p>
      ) : null}
    </div>
  )
}
