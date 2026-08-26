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
        {/* The heading names the state; the glyph is decoration. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          className="h-5 w-5"
        >
          <circle cx="9" cy="9" r="5.75" strokeWidth="1.75" />
          <path d="M13.5 13.5l3.5 3.5" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
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
