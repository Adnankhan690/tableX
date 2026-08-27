import { SearchX } from 'lucide-react'
import Link from 'next/link'

/**
 * A wrong URL is nearly always a stale bookmark to an order that has since closed, so the way out
 * is the board rather than a generic "go home".
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-muted"
      >
        <SearchX aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div>
        <h1 className="text-display font-semibold">Page not found</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-base text-muted">
          The link may be a bookmark to an order that has since been closed.
        </p>
      </div>
      <Link
        href="/orders"
        className="inline-flex min-h-tap items-center rounded-control border border-accent bg-accent px-3.5 text-base font-medium text-accent-ink shadow-card transition-colors hover:bg-accent-hover"
      >
        Back to the board
      </Link>
    </main>
  )
}
