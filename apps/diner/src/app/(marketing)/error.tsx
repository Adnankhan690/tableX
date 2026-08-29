'use client'

/**
 * A boundary for the marketing page alone.
 *
 * `(app)/error.tsx` cannot serve here: it renders diner copy ("scan the QR code on your table"),
 * which is nonsense to a stranger who arrived from a search result, and its wrapper assumes the
 * phone column. This one is audience-neutral and keeps the wordmark, so a failed render still
 * looks like a site rather than a blank page.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next names this export Error by convention
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-[1.35rem] font-semibold tracking-[-0.015em] text-ink">
        tabley
      </p>
      <h1 className="max-w-[24ch] font-display text-[clamp(28px,3.2vw,42px)] font-semibold leading-[1.08] tracking-[-0.022em] text-ink">
        This page did not load.
      </h1>
      <p className="max-w-[48ch] text-[1.0625rem] leading-[1.55] text-muted">
        Usually a connection problem rather than anything broken. Try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 flex min-h-tap items-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
      >
        Try again
      </button>
    </main>
  )
}
