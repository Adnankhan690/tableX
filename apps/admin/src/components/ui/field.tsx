'use client'

import { cn } from '@tablex/ui'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'

/**
 * The shared shape of every text control.
 *
 * `bg-field` rather than transparent: a filled box is what makes an input identifiable as a
 * control, which is what lets the resting border stay a quiet 1.77:1 instead of shouting.
 *
 * Note the absence of `outline-none`. Tailwind compiles it to a transparent 2px outline in the
 * utilities layer, which outranks the `:focus-visible` rule in globals.css and silently deletes
 * the focus ring -- six inputs in this app used to do that, on the one screen where a stray
 * keystroke changes a price.
 */
const CONTROL =
  'w-full rounded-control border border-line-strong bg-field text-ink placeholder:text-faint ' +
  'transition-colors duration-100 hover:border-muted ' +
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-muted ' +
  'aria-[invalid=true]:border-danger'

export interface FieldProps {
  label: string
  /** Static guidance. Always visible; not a substitute for a label. */
  hint?: ReactNode
  /** When set, the field is in an error state and this replaces the hint. */
  error?: string
  /** Marks the control required and prints nothing -- required is the default assumption here. */
  optional?: boolean
  className?: string
  /** Receives the wired id, aria-describedby and aria-invalid. */
  children: (wiring: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/**
 * Label, control and message as one block, with the aria wiring done once.
 *
 * Validation lives next to the field rather than in a page-level banner: the settings form used to
 * report "GST must be between 0 and 30" at the top of a 2400px page, leaving the manager to find
 * which of eight numeric inputs it meant.
 */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-faint">(optional)</span> : null}
      </label>
      {children({ id, describedBy: message ? messageId : undefined, invalid: Boolean(error) })}
      {message ? (
        <p
          id={messageId}
          // The error is announced, the hint is not: a hint that interrupts a screen-reader user
          // every time they tab into a field is noise, an error is the reason they cannot proceed.
          role={error ? 'alert' : undefined}
          className={cn('mt-1.5 text-xs', error ? 'font-medium text-danger' : 'text-muted')}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Right-aligned monospaced-width numerals, for money and percentages. */
  numeric?: boolean
  /** A short static affix rendered inside the control, e.g. ₹ or %. */
  prefix?: string
  suffix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { numeric = false, prefix, suffix, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={cn(
        CONTROL,
        'min-h-tap px-3 text-base',
        numeric ? 'text-right [font-variant-numeric:tabular-nums]' : '',
        prefix ? 'rounded-l-none border-l-0 pl-1' : '',
        suffix ? 'rounded-r-none border-r-0 pr-1' : '',
        className,
      )}
      {...rest}
    />
  )
  if (!prefix && !suffix) return input
  // The affix is part of the control's box rather than a floating span, so the whole thing reads
  // as one field and the number does not drift away from its unit.
  return (
    <div className="flex min-w-0 items-stretch">
      {prefix ? (
        <span
          aria-hidden="true"
          className="inline-flex min-h-tap select-none items-center rounded-l-control border border-r-0 border-line-strong bg-surface-sunken px-2.5 text-sm text-muted"
        >
          {prefix}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span
          aria-hidden="true"
          className="inline-flex min-h-tap select-none items-center rounded-r-control border border-l-0 border-line-strong bg-surface-sunken px-2.5 text-sm text-muted"
        >
          {suffix}
        </span>
      ) : null}
    </div>
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL, 'px-3 py-2 text-base', className)}
      {...rest}
    />
  )
})
