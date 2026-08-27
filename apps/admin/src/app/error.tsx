'use client'

import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui'

/**
 * `reset` re-renders the failed segment, which recovers a transient fetch failure without making a
 * staff member sign in again mid-service. The raw error is still not shown -- it is a bundler or
 * React message, not something a manager can act on -- but `digest` is, because it is the one
 * string that lets someone reading the server logs find this exact failure.
 *
 * The alternatives matter as much as the retry: this used to be a single button, so a staff member
 * whose board had broken mid-service had no route to the rest of the panel or to a fresh sign-in.
 *
 * The name shadows the global Error, and stays that way: Next requires this to be the default
 * export of error.tsx and names it Error by convention.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next names this export Error by convention
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger"
      >
        <CircleAlert aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div>
        <h1 className="text-display font-semibold">Something went wrong</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-base text-muted">
          This is usually a connection problem. Try again — nothing you had open has been lost.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/orders"
          className="inline-flex min-h-tap items-center rounded-control border border-line-strong bg-surface px-3.5 text-base font-medium transition-colors hover:bg-surface-sunken"
        >
          Go to the board
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-tap items-center rounded-control px-3.5 text-base font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          Sign in again
        </Link>
      </div>
      {error.digest ? (
        <p className="text-xs text-faint">
          Quote this if you report it: <span className="font-mono text-muted">{error.digest}</span>
        </p>
      ) : null}
    </main>
  )
}
