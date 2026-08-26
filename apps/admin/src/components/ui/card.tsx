import { cn } from '@tablex/ui'
import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the padding, for a card whose body is a list that rules to its own edges. */
  flush?: boolean
  children: ReactNode
}

/**
 * The panel's one container.
 *
 * A hairline plus the smallest shadow in the scale, not a heavy border: with a white card on a
 * near-white canvas the edge only has to be found, not announced, and the previous 1.66:1 border
 * turned every list of three things into a stack of three boxes.
 */
export function Card({ flush = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        flush ? '' : 'p-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  /** One sentence. If it needs two, it belongs in the body. */
  description?: ReactNode
  /** Right-aligned controls. One primary at most. */
  actions?: ReactNode
  /** Heading level, so a card inside a page with an h1 does not skip to h3. */
  as?: 'h2' | 'h3'
  className?: string
}

/**
 * A card's title row.
 *
 * The title is a real heading at body size, not an ALL-CAPS micro-label. Six surfaces used
 * `text-xs uppercase text-muted` as a section heading, which reads as a table column header
 * rather than as the name of the thing below it, and gives a screen reader nothing to navigate by.
 */
export function CardHeader({
  title,
  description,
  actions,
  as: Heading = 'h2',
  className,
}: CardHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className="text-lg font-semibold text-ink">{title}</Heading>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** A ruled section inside a flush card: list rows, table bodies, footers. */
export function CardSection({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-t border-divider px-4 py-3 first:border-t-0', className)} {...rest}>
      {children}
    </div>
  )
}
