'use client'

import type { OrderStatsView } from '@tablex/shared'
import { cn } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
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

/** The figures, in order. Used by the loading state so it lays out exactly like the real thing. */
const FIGURE_LABELS = [
  'Placed',
  'Live',
  'Completed',
  'Cancelled',
  'Revenue',
  'Unpaid',
  'Avg. to accept',
  'Avg. to complete',
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

/**
 * The board's summary line.
 *
 * A wrapping grid, not a horizontally scrolling flex row: at the 820px tablet target only five of
 * eight tiles fitted, the sixth was sliced in half at the edge and the last two were unreachable
 * without a gesture nobody knew was available. Figures that cannot be seen are not a summary.
 *
 * Scope is stated once, in the header above, rather than repeated in three tile labels that then
 * contradicted the board beneath them.
 */
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

  if (stats === null) {
    return (
      <div className="no-print grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3 sm:grid-cols-4 xl:grid-cols-8">
        {/* Keyed by the label they stand in for, so the placeholders are stable rows rather than
            positions in an array. */}
        {FIGURE_LABELS.map((label) => (
          <div key={label} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <section
      aria-label="Today's figures"
      className="no-print border-b border-line bg-surface px-4 py-3"
    >
      {/*
        The scope is stated ONCE, here, instead of in three of the eight labels. "Placed today" and
        "Live now" sat side by side above a board showing four live orders, so the strip appeared to
        contradict the thing directly beneath it -- the figures are today's, the board is filtered.
      */}
      <p className="mb-2 text-xs font-medium text-faint">Today</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
        <Figure label="Placed" value={String(stats.orders_placed)} />
        <Figure label="Live" value={String(stats.orders_live)} emphasis={stats.orders_live > 0} />
        <Figure label="Completed" value={String(stats.orders_completed)} />
        <Figure label="Cancelled" value={String(stats.orders_cancelled)} />
        <Figure label="Revenue" value={stats.revenue.display} />
        <Figure
          label="Unpaid"
          value={stats.unpaid_amount.display}
          tone={stats.unpaid_amount.minor > 0 ? 'warn' : undefined}
        />
        {/*
        Null renders as an em dash, never as "0s". A zero would claim orders are being accepted
        instantly, which is a different and false statement.
      */}
        <Figure
          label="Avg. to accept"
          value={stats.avg_accept_secs != null ? formatDuration(stats.avg_accept_secs) : '—'}
        />
        <Figure
          label="Avg. to complete"
          value={stats.avg_fulfil_secs != null ? formatDuration(stats.avg_fulfil_secs) : '—'}
        />
      </dl>
    </section>
  )
}

/**
 * One figure.
 *
 * No box. Eight bordered tiles in a row read as eight competing objects; a label over a value on
 * an open surface reads as a summary, which is what it is. The label is the small thing and the
 * number is the large one, so the row scans as numbers first.
 */
function Figure({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string
  value: string
  emphasis?: boolean
  tone?: 'warn'
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-faint">{label}</dt>
      <dd
        className={cn(
          'truncate text-metric font-semibold [font-variant-numeric:tabular-nums]',
          emphasis ? 'text-accent' : '',
          tone === 'warn' ? 'text-warning' : '',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
