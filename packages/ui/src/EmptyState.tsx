import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  title: string
  description?: string
  /** Slot for the one thing to do next -- a link back to the menu, a "clear filters" button. */
  action?: ReactNode
  className?: string
}

/**
 * The nothing-here state: an empty cart, a kitchen board with no live orders, a filter that
 * matched nothing.
 *
 * The title is a plain paragraph, not a heading. This renders inside a card in one place and
 * as a whole page in another, so any level baked in here would be wrong somewhere and put a
 * hole in the document outline; the caller owns its own heading structure.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}
      data-empty-state=""
    >
      <p className="text-sm font-medium text-[var(--tx-fg,#1f2430)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--tx-muted-fg,#6b7280)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
