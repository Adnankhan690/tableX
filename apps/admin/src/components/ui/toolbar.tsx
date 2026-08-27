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
  children: ReactNode
}

/**
 * A filter that is either on or off.
 *
 * `aria-pressed` rather than a checkbox: it is a control that changes what the list shows, not a
 * value being collected, and the pressed state is what a screen reader needs to hear.
 */
export function ToggleChip({ active, className, children, ...rest }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-control border px-3 text-sm font-medium',
        'transition-colors duration-100',
        active
          ? 'border-accent-line bg-accent-soft text-accent'
          : 'border-line-strong bg-surface text-muted hover:border-muted hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
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
