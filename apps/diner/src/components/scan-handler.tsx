'use client'

import { isApiError } from '@tablex/api-client'
import { Spinner } from '@tablex/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/components/providers'
import { CenteredMessage } from '@/components/screen'
import { api } from '@/lib/api'
import { sessionFromScan } from '@/lib/session'

type State = { kind: 'scanning' } | { kind: 'dead-end'; title: string; body: string }

/**
 * Turns a scanned QR token into a session and sends the diner to the menu.
 *
 * This is the single request that stands between scanning and seeing food, so it does
 * everything at once -- the API returns the session, the table and the whole menu in one
 * response (PRD 3, PRD 7).
 */
export function ScanHandler({ qrToken }: { qrToken: string }) {
  const router = useRouter()
  const { setSession } = useSession()
  const [state, setState] = useState<State>({ kind: 'scanning' })

  /**
   * React 19 Strict Mode runs effects twice in development. Without this guard the scan fires
   * twice and creates two guest sessions, the second of which silently orphans the first --
   * so the diner's cart would be keyed to a session the app has already discarded.
   */
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const controller = new AbortController()

    api
      .scanTable(qrToken, controller.signal)
      .then((scan) => {
        setSession(sessionFromScan(scan))
        /**
         * replace, not push. With push, the browser back button re-runs this route and creates
         * another session -- and "back" from the menu should leave the app, not silently
         * re-scan.
         */
        router.replace('/menu')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return

        // A rotated, peeled-off or mistyped QR (TX_TBL_004). A dead end rather than a retry:
        // retrying the same dead token cannot succeed, and the fix is a person, not a button
        // (docs/DECISIONS.md D4).
        if (isApiError(err) && err.code === 'TX_TBL_004') {
          setState({
            kind: 'dead-end',
            title: 'This QR code is no longer valid',
            body: 'Please ask a staff member for the current code for your table.',
          })
          return
        }

        if (isApiError(err) && err.code === 'TX_TBL_002') {
          setState({
            kind: 'dead-end',
            title: 'This table is not taking orders',
            body: 'Please ask a staff member to seat you at another table.',
          })
          return
        }

        if (isApiError(err) && err.code === 'TX_RST_002') {
          setState({
            kind: 'dead-end',
            title: 'Not accepting orders right now',
            body: 'This restaurant has self-ordering switched off. Please order with a staff member.',
          })
          return
        }

        setState({
          kind: 'dead-end',
          title: 'Could not load the menu',
          body: isApiError(err) ? err.message : 'Check your connection and scan the code again.',
        })
      })

    return () => controller.abort()
  }, [qrToken, router, setSession])

  if (state.kind === 'dead-end') {
    return <CenteredMessage title={state.title} body={state.body} tone="warn" />
  }

  // Intentionally sparse. This is on screen for a fraction of a second on a good connection
  // and a few seconds on a bad one, and anything more elaborate would be a flash of layout.
  return (
    <CenteredMessage
      title="Opening the menu"
      body={
        <span className="inline-flex items-center gap-2">
          <Spinner /> One moment
        </span>
      }
    />
  )
}
