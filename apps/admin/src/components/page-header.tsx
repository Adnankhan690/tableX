import { cn } from '@tablex/ui'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  /** One line of context: what this page is showing right now. */
  subtitle?: ReactNode
  /**
   * The page's actions. Exactly one filled primary per screen -- the five pages used to show four
   * different answers here (a filled button, an outline, a bare link, nothing), so the slot taught
   * staff nothing about where the important control lives.
   */
  actions?: ReactNode
  /** Live status, counts, a connection indicator: read-only, sits left of the actions. */
  meta?: ReactNode
  /** A way back, rendered above the title. Only on a detail page. */
  back?: { href: string; label: string }
  className?: string
}

/**
 * Every page's first band.
 *
 * `sticky top-0` so the page identity and its primary action stay reachable on the Menu page,
 * which is 8,500px tall at production scale -- scrolling to the bottom of a 93-dish list used to
 * mean losing the only "Add category" button.
 *
 * The title is `text-title` (18px). It was `text-base`, which made it the smallest h1 in the app:
 * the stats values, every card title and the login heading all outranked the name of the page.
 */
export function PageHeader({ title, subtitle, actions, meta, back, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
        'border-b border-line bg-surface px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 mb-0.5 inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-xs font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            {back.label}
          </Link>
        ) : null}
        <h1 className="truncate text-title font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {meta}
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
