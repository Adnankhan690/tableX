'use client'

// The only client component in the package: the retry button needs a handler, and everything
// else here is static enough to render on the server (docs/DECISIONS.md D11 -- the diner app
// ships as little client JS as it can get away with).

import { cn } from './cn'

export interface ErrorStateProps {
  /** The server's human-readable message, already translated by whoever produced it. */
  message: string
  /** The stable machine code, e.g. `TX_ORD_006`. */
  code?: string
  requestId?: string
  onRetry?: () => void
  className?: string
}

/**
 * The something-went-wrong state.
 *
 * It takes a pre-shaped error rather than `unknown` plus `isApiError` from
 * @tablex/api-client on purpose. That dependency would drag the transport layer and its
 * configuration into every app that only wanted a badge or a spinner, and it would point the
 * dependency the wrong way -- presentation would know how the app talks to its server. Each
 * app instead maps a caught error into these props, which is a handful of lines it already
 * needs in order to route `.isStale` to a refetch and `.isSessionError` to a rescan rather
 * than to a message like this one.
 *
 * The message is rendered as the server sent it, never replaced with our own wording: the
 * server is the only party that knows whether the kitchen rejected the order, the item went
 * sold out, or the total moved.
 */
export function ErrorState({ message, code, requestId, onRetry, className }: ErrorStateProps) {
  return (
    // role="alert" because this almost always replaces content the user was waiting on, and
    // an unannounced swap leaves a screen reader user staring at a page that simply stopped.
    <div
      className={cn('flex flex-col items-start gap-2 px-4 py-6 text-left', className)}
      role="alert"
      data-error-code={code}
    >
      <p className="text-sm font-medium text-[var(--tx-error-fg,#93211f)]">{message}</p>

      {/*
        The identifiers are shown, not hidden in a console. A diner can read the request id
        out to the staff member standing next to them, and whoever picks it up afterwards can
        grep one string across the logs. The code sits beside it because it survives
        translation (PRD 7) where the message above does not.
      */}
      {code || requestId ? (
        <p className="font-mono text-[11px] leading-4 text-[var(--tx-muted-fg,#616875)]">
          {code ? <span data-error-code-text="">{code}</span> : null}
          {code && requestId ? ' · ' : null}
          {requestId ? <span data-request-id={requestId}>ref {requestId}</span> : null}
        </p>
      ) : null}

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border border-current px-3 py-1.5 text-sm font-medium"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
