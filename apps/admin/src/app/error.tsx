'use client'

/**
 * `reset` re-renders the failed segment, which recovers a transient fetch failure without
 * making a staff member sign in again mid-service. The raw error is not shown: it is a bundler
 * or React message, and the actionable detail is the request id carried on any API failure.
 *
 * The name shadows the global Error, and stays that way: Next requires this to be the default
 * export of error.tsx and names it Error by convention.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next names this export Error by convention
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">
        This is usually a connection problem. Try again, or reload the page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-tap rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink"
      >
        Try again
      </button>
    </main>
  )
}
