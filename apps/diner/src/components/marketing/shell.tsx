import { cn } from '@tablex/ui'
import type { ReactNode } from 'react'

/**
 * Layout furniture for the marketing page, so eleven sections cannot each invent their own
 * container width and end up a few pixels apart — the same reason `screen.tsx` exists for the
 * diner app.
 */

/**
 * The one container width on the page.
 *
 * Explicit px, not `max-w-6xl`. This app sets `html { font-size: 17px }`, so every rem-based
 * Tailwind size renders 6.25% larger than its name: `max-w-6xl` would be 1224px, not 1152.
 * Anything sized against the *viewport* rather than against the type has to say so in px.
 */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-10', className)}>
      {children}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-accent',
        className,
      )}
    >
      {children}
    </p>
  )
}

/**
 * The section heading block: eyebrow, h2, lead.
 *
 * `id` is the h2's id and must match the section's `aria-labelledby` — passing it here rather
 * than letting each section wire its own is what keeps every section actually labelled.
 */
export function SectionHeader({
  id,
  eyebrow,
  title,
  lead,
  dark = false,
  className,
}: {
  id: string
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
  dark?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      {eyebrow ? (
        // On the inverted band the accent measures 3.36:1 against --tx-ink and fails as text.
        <Eyebrow className={dark ? 'text-accent-soft' : undefined}>{eyebrow}</Eyebrow>
      ) : null}
      <h2
        id={id}
        className={cn(
          'max-w-[18ch] font-display text-[clamp(28px,3.2vw,42px)] font-semibold leading-[1.08] tracking-[-0.022em]',
          eyebrow ? 'mt-3' : undefined,
          dark ? 'text-bg' : 'text-ink',
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            'mt-4 max-w-[54ch] text-[1.0625rem] leading-[1.55] md:text-[1.1875rem]',
            dark ? 'text-[var(--mk-text-dark)]' : 'text-muted',
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A description of a drawn mock, for screen readers.
 *
 * Every mock on this page is `aria-hidden`, because it is an illustration built out of divs and
 * a reader tabbing through its 60 nested boxes learns nothing. This is its replacement, and it
 * is required rather than optional: the mocks carry real product facts (prices, statuses, a
 * sold-out dish) and those facts must reach a reader who cannot see them.
 */
export function MockDescription({ children }: { children: ReactNode }) {
  return <p className="sr-only">{children}</p>
}
