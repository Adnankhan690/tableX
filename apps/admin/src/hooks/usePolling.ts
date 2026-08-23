'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `fn` on an interval, pausing while the tab is hidden.
 *
 * The visibility check is the point. A tablet left on the order board overnight would otherwise
 * poll every few seconds until its battery is flat, and every one of those requests is wasted --
 * nobody is looking. Resuming fires immediately on becoming visible, so the board is current
 * the moment a staff member picks the tablet up rather than one interval later.
 */
export function usePolling(fn: () => void, intervalMs: number, enabled = true): void {
  // Held in a ref so an inline arrow -- which is what every caller passes -- does not tear down
  // and rebuild the interval on every render.
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer !== null) return
      timer = setInterval(() => fnRef.current(), intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fnRef.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, enabled])
}
