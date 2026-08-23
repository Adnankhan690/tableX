'use client'

import { useEffect, useRef, useState } from 'react'
import { adminStreamUrl } from '@/lib/api'

const POLL_INTERVAL_MS = 5_000
const CONNECT_TIMEOUT_MS = 4_000

export interface AdminStreamState {
  /**
   * Whether a socket is open.
   *
   * Surfaced to the UI on purpose: staff decide whether to trust the board in real time based on
   * this. A board that has silently fallen back to five-second polling is still correct, but a
   * staff member watching for a new order deserves to know which mode they are in.
   */
  live: boolean
}

/**
 * Keeps the order board fresh (docs/DECISIONS.md D10).
 *
 * As on the diner side, a socket message never carries state -- it only triggers `onChange`, and
 * the caller refetches over HTTP. A dropped frame therefore costs one polling interval and
 * nothing else, and the board can never diverge from the database.
 */
export function useAdminStream(
  token: string | null,
  onChange: () => void,
  enabled = true,
): AdminStreamState {
  const [live, setLive] = useState(false)

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!token || !enabled) {
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
      socket = new WebSocket(adminStreamUrl(token))
    } catch {
      startPolling()
      return () => {
        disposed = true
        stopPolling()
      }
    }

    // Restaurant wifi produces sockets that never finish opening. Polling starts on a timer and
    // is cancelled if the socket wins, so the board is never simply frozen.
    connectTimer = setTimeout(() => {
      if (!disposed && socket?.readyState !== WebSocket.OPEN) startPolling()
    }, CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (disposed) return
      setLive(true)
      stopPolling()
      // Closes the gap between the page loading and the socket opening, during which a new order
      // would otherwise have gone unnoticed.
      onChangeRef.current()
    }
    socket.onmessage = () => {
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
        startPolling()
      }
    }

    return () => {
      disposed = true
      if (connectTimer !== null) clearTimeout(connectTimer)
      stopPolling()
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
  }, [token, enabled])

  return { live }
}
