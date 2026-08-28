import { cn } from '@tablex/ui'
import type { ReactNode } from 'react'

/**
 * Shared page furniture, so the eight diner screens do not each invent their own header
 * spacing and end up a few pixels apart.
 */

/** A full-height centred message: loading, dead ends, empty states. */
export function CenteredMessage({
  title,
  body,
  action,
  tone = 'neutral',
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'warn'
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <h1 className={cn('text-xl font-semibold', tone === 'warn' ? 'text-nonveg' : 'text-ink')}>
        {title}
      </h1>
      {body ? (
        <div className="max-w-xs text-[0.9375rem] leading-relaxed text-muted">{body}</div>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </main>
  )
}

/**
 * The sticky screen header.
 *
 * The table label is the most important thing on it. A diner needs to confirm at a glance
 * that they are ordering to the table they are sitting at -- getting that wrong sends food
 * across the room, and it is the one error this product can make that a waiter would not.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  back,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  back?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="flex items-center gap-3 px-4 py-3">
        {back}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.0625rem] font-semibold leading-tight">{title}</p>
          {subtitle ? (
            <p className="truncate text-[0.8125rem] leading-tight text-muted">{subtitle}</p>
          ) : null}
        </div>
        {right}
      </div>
    </header>
  )
}

/** The primary full-width action button. Meets the 44px tap floor by construction. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-tap w-full items-center justify-center gap-2 rounded-card',
        'bg-accent px-5 py-3 text-[1.0625rem] font-semibold text-accent-ink',
        'transition-opacity active:opacity-80 disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A quieter secondary action. */
export function SecondaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-tap w-full items-center justify-center rounded-card border border-line',
        'bg-surface px-5 py-3 text-[0.9375rem] font-medium text-ink',
        'transition-opacity active:opacity-70 disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * The sticky bottom bar.
 *
 * Bottom-anchored rather than a top nav because thumbs reach the bottom of a phone, and this
 * is where every screen's primary action lives. pb-safe keeps it clear of the iPhone home
 * indicator, without which the main CTA is partly untappable.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-phone">
      <div className="border-t border-line bg-surface px-4 pt-3 shadow-bar pb-safe">{children}</div>
    </div>
  )
}
