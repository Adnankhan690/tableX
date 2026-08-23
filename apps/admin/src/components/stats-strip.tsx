'use client'

import type { OrderStatsView } from '@tablex/shared'
import { formatElapsed } from '@tablex/shared'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
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

export function StatsStrip() {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<OrderStatsView | null>(null)

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .statsToday(token)
        .then(setStats)
        .catch(() => {
          /* The board below is the important thing on this page; a missing stat strip must not
             take it down. */
        })
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])
  usePolling(load, STATS_POLL_MS)

  if (stats === null) return null

  return (
    <div className="no-print scroll-x-contain flex gap-2 border-b border-line bg-surface px-4 py-3">
      <Tile label="Placed today" value={String(stats.orders_placed)} />
      <Tile label="Live now" value={String(stats.orders_live)} emphasis={stats.orders_live > 0} />
      <Tile label="Completed" value={String(stats.orders_completed)} />
      <Tile label="Cancelled" value={String(stats.orders_cancelled)} />
      <Tile label="Revenue" value={stats.revenue.display} />
      <Tile label="Unpaid" value={stats.unpaid_amount.display} />
      {/*
        Null renders as "--", never as "0s". A zero would claim orders are being accepted
        instantly, which is a different and false statement -- and it is exactly the number a
        restaurant owner would quote at us.
      */}
      <Tile
        label="Avg. to accept"
        value={stats.avg_accept_secs != null ? formatElapsed(stats.avg_accept_secs) : '--'}
      />
      <Tile
        label="Avg. to complete"
        value={stats.avg_fulfil_secs != null ? formatElapsed(stats.avg_fulfil_secs) : '--'}
      />
    </div>
  )
}

function Tile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-[6.5rem] shrink-0 rounded-card border border-line px-3 py-2">
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={
          emphasis
            ? 'text-lg font-bold tabular-nums text-accent'
            : 'text-lg font-semibold tabular-nums'
        }
      >
        {value}
      </p>
    </div>
  )
}
