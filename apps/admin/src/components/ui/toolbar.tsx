'use client'

import { cn } from '@tablex/ui'
import { Search, X } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

/**
 * The strip of filters above a list.
 *
 * One band, not three: the board used to stack a page header, a stats strip and a filter row --
 * three full-width bordered bands eating 190px before the first ticket. Anything that filters
 * belongs here; anything that summarises belongs in the header.
 */
export function Toolbar({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'no-print flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export interface ToggleChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean
  /**
   * A queue depth. Rendered as a badge inside the chip.
   *
   * Only pass it for something a person is expected to work through -- a badge reads as "this many
   * are waiting for you", so putting one on an archive turns a record into a demand.
   */
  count?: number
  /**
   * Whether a non-zero count means someone should act now.
   *
   * `urgent` fills the badge with the accent; anything else keeps it quiet. A zero is ALWAYS quiet
   * whatever this says -- an empty queue that shouts is how staff learn to stop reading badges.
   */
  countTone?: 'neutral' | 'urgent'
  children: ReactNode
}

/**
 * A filter that is either on or off.
 *
 * `aria-pressed` rather than a checkbox: it is a control that changes what the list shows, not a
 * value being collected, and the pressed state is what a screen reader needs to hear.
 */
export function ToggleChip({
  active,
  count,
  countTone = 'neutral',
  className,
  children,
  ...rest
}: ToggleChipProps) {
  const loud = countTone === 'urgent' && count !== undefined && count > 0
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        // Fully rounded, and that is a system rule rather than a flourish: a chip is a filter you
        // toggle, an input is a box you type in. Giving the two different silhouettes means the
        // toolbar reads as two kinds of control at a glance instead of one row of similar rectangles.
        'inline-flex shrink-0 items-center gap-2 rounded-full border font-medium',
        // Compact below `sm` -- see the tap-token note in tailwind.config.ts.
        'min-h-tap-sm pl-3 text-xs sm:min-h-tap sm:pl-3.5 sm:text-sm',
        'transition-colors duration-100',
        // Tighter on the right when a badge is present, so the badge sits inside the pill rather
        // than looking bolted on.
        count !== undefined ? 'pr-1.5' : 'pr-3.5',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line-strong bg-surface text-muted hover:border-muted hover:bg-surface-sunken hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5',
            'text-xs font-semibold [font-variant-numeric:tabular-nums]',
            loud
              ? // Filled, so a waiting queue is visible from across a counter.
                'bg-accent text-accent-ink'
              : active
                ? // On an active chip the badge sits on accent-soft, so a neutral grey would
                  // disappear into it.
                  'bg-surface text-accent'
                : 'bg-surface-sunken text-faint',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

export interface SearchInputProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  /** Required: this control never carries a visible label. */
  label: string
}

/**
 * A search box with its magnifier and a clear button.
 *
 * The clear button matters more than it looks: a filter left set is the most common reason a
 * staff member reports "my orders disappeared", and the only way out was to select the text and
 * delete it.
 */
export function SearchInput({
  value,
  onValueChange,
  placeholder,
  label,
  className,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn('relative flex min-w-0 flex-1 items-center', className)} {...rest}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 h-4 w-4 text-faint"
        strokeWidth={1.75}
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          'min-h-tap w-full rounded-control border border-line-strong bg-field pl-9 pr-9 text-base',
          'text-ink placeholder:text-faint transition-colors duration-100 hover:border-muted',
          // The browser's own clear affordance is a 10px grey cross that does not match anything
          // else here, and it only exists in WebKit.
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}
