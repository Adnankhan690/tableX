'use client'

import { cn } from '@tablex/ui'
import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const BADGE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-sunken text-muted',
  accent: 'border-accent-line bg-accent-soft text-accent',
  success: 'border-success-line bg-success-soft text-success',
  warning: 'border-warning-line bg-warning-soft text-warning',
  danger: 'border-danger-line bg-danger-soft text-danger',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  children: ReactNode
}

/** A state label. Never a button -- if it can be clicked it is a chip, not a badge. */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        BADGE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

/** A count beside its own label, in tabular figures so it does not shift as it changes. */
export function Count({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[1.5rem] justify-center rounded-full bg-surface-sunken px-1.5 py-0.5',
        'text-xs font-semibold text-muted [font-variant-numeric:tabular-nums]',
        className,
      )}
    >
      {value}
    </span>
  )
}

const NOTICE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-sunken text-ink',
  accent: 'border-accent-line bg-accent-soft text-ink',
  success: 'border-success-line bg-success-soft text-ink',
  warning: 'border-warning-line bg-warning-soft text-ink',
  danger: 'border-danger-line bg-danger-soft text-ink',
}

const ICON: Record<Tone, LucideIcon> = {
  neutral: Info,
  accent: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

export interface NoticeProps {
  tone?: Tone
  /** Optional bolded lead line. The body is the children. */
  title?: ReactNode
  children?: ReactNode
  /** Right-aligned action, e.g. a retry or a dismiss. */
  action?: ReactNode
  className?: string
}

/**
 * A message about what just happened, or about a consequence.
 *
 * Tone drives the aria role, not just the colour: `danger` announces itself with role="alert"
 * because a failed save the user does not notice is a save they believe succeeded, while a
 * confirmation is role="status" and waits its turn. Four surfaces used to render every outcome --
 * "Saved.", "Could not save.", and two validation failures -- through one accent-tinted
 * role="status" paragraph, so a failure looked exactly like a success.
 */
export function Notice({ tone = 'neutral', title, children, action, className }: NoticeProps) {
  const ToneIcon = ICON[tone]
  const iconTint =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : tone === 'accent'
            ? 'text-accent'
            : 'text-muted'
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn(
        'flex items-start gap-2.5 rounded-card border px-3 py-2.5 text-sm animate-fade-in',
        NOTICE[tone],
        className,
      )}
    >
      <ToneIcon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn('mt-0.5 h-4 w-4 shrink-0', iconTint)}
      />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5 text-muted' : '')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export interface EmptyStateProps {
  title: string
  /** Say what to do next, not just that there is nothing. */
  description?: ReactNode
  action?: ReactNode
  /** A lucide icon, shown at 20px in a sunken disc. */
  icon?: LucideIcon
  className?: string
  /** For an empty column on the board, where a full-height panel would blow the layout apart. */
  compact?: boolean
}

/** What a surface says when it has nothing to show. Every list in this app owes one. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-line text-center',
        compact ? 'gap-1 px-3 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      {Icon && !compact ? (
        <span className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-muted">
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
        </span>
      ) : null}
      <p className={cn('font-medium text-ink', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {description ? (
        <p className={cn('max-w-sm text-muted', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * Preferred over a centred spinner for a list or a card: the layout does not jump when the data
 * lands, which on a board that refetches every few seconds is the difference between a calm screen
 * and a flickering one.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse-slow rounded-control bg-surface-sunken', className)}
    />
  )
}
