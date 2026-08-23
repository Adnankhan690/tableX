'use client'

import { useEffect, useRef, useState } from 'react'
import { orderStreamUrl } from '@/lib/api'

/** How often to poll when the socket is unavailable. */
const POLL_INTERVAL_MS = 5_000

/** How long to wait for the socket before giving up and polling. */
const CONNECT_TIMEOUT_MS = 4_000

export interface OrderStreamState {
  /** True while a socket is open. Shown to the diner so they know updates are live. */
  live: boolean
}

/**
 * Keeps an order's status fresh (docs/DECISIONS.md D10).
 *
 * The contract is the important part: this hook NEVER supplies data. A socket message only
 * triggers `onChange`, and the caller refetches over HTTP. That is what makes a dropped frame
 * harmless, and it is why the polling fallback below is a complete substitute rather than a
 * degraded mode -- polling alone already satisfies PRD 6.5, so the socket is an optimisation
 * on something that works without it.
 *
 * Polling runs whenever the socket is not open, and stops once `terminal` is true: a
 * completed or cancelled order will never change again, and a phone left on the tracking
 * screen overnight should not poll until its battery dies.
 */
export function useOrderStream(
  orderUid: string | null,
  token: string | null,
  onChange: () => void,
  terminal = false,
): OrderStreamState {
  const [live, setLive] = useState(false)

  /**
   * `onChange` is almost always an inline arrow, so it is a new function every render. Held
   * in a ref and read at call time so the socket is not torn down and reopened on each
   * render -- which would reconnect several times a second and never deliver anything.
   */
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!orderUid || !token || terminal) {
      setLive(false)
      return
    }

    let socket: WebSocket | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const startPolling = () => {
      if (disposed || pollTimer !== null) return
      pollTimer = setInterval(() => onChangeRef.current(), POLL_INTERVAL_MS)
    }

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    try {
      socket = new WebSocket(orderStreamUrl(orderUid, token))
    } catch {
      // Some in-app browsers block WebSocket construction outright. Polling covers it.
      startPolling()
      return () => {
        disposed = true
        stopPolling()
      }
    }

    /**
     * Restaurant wifi produces sockets that open slowly or never resolve. Rather than leave
     * the diner staring at a screen that is not updating, polling starts on a timer and is
     * cancelled if the socket comes up first.
     */
    connectTimer = setTimeout(() => {
      if (!disposed && socket?.readyState !== WebSocket.OPEN) startPolling()
    }, CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (disposed) return
      setLive(true)
      stopPolling()
      // A refetch on connect closes the gap between the page's first load and the socket
      // opening, during which a status change would otherwise have been missed entirely.
      onChangeRef.current()
    }

    socket.onmessage = () => {
      // The payload is deliberately ignored. It names an order and a status, and trusting it
      // would make the socket a second source of truth that disagrees with the API after any
      // dropped frame.
      if (!disposed) onChangeRef.current()
    }

    socket.onerror = () => {
      if (!disposed) {
        setLive(false)
        startPolling()
      }
    }

    socket.onclose = () => {
      if (!disposed) {
        setLive(false)
        // No reconnect loop here on purpose. A closed socket usually means a proxy that will
        // close the next one too, and a reconnect loop on a flaky restaurant connection burns
        // battery to end up polling anyway.
        startPolling()
      }
    }

    return () => {
      disposed = true
      if (connectTimer !== null) clearTimeout(connectTimer)
      stopPolling()
      // Handlers are detached before closing so the onclose above does not start polling for
      // a screen that has already unmounted.
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
      }
      setLive(false)
    }
  }, [orderUid, token, terminal])

  return { live }
}
