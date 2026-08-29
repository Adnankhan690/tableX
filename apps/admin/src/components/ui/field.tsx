'use client'

import { cn } from '@tablex/ui'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'

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
        /*
          The SAME responsive tap floor the Button uses (see the note on its SIZE map): 36px below
          `sm`, 40px from `sm` up.

          It was `min-h-tap` unconditionally, which meant that on a phone every input stood 40px
          tall beside a 36px button -- and on the menu manager a price field sits directly next to
          "Mark sold out", so the two adjacent controls visibly failed to line up. The floors are a
          pair; only one of them had been told.
        */
        'min-h-tap-sm px-3 text-sm sm:min-h-tap sm:text-base',
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
          className="inline-flex min-h-tap-sm select-none items-center rounded-l-control border border-r-0 border-line-strong bg-surface-sunken px-2.5 text-sm text-muted sm:min-h-tap"
        >
          {prefix}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span
          aria-hidden="true"
          className="inline-flex min-h-tap-sm select-none items-center rounded-r-control border border-l-0 border-line-strong bg-surface-sunken px-2.5 text-sm text-muted sm:min-h-tap"
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

/**
 * A password field with a reveal toggle.
 *
 * Its own component rather than an `Input` affix: `prefix`/`suffix` above are static
 * `aria-hidden` strings, and this has to be a real focusable control with a name that changes.
 *
 * WHAT THE TOGGLE IS AND IS NOT FOR. It exists so someone can check what they typed on a phone
 * keyboard, which is the actual cause of failed sign-ins. It is not a security feature in either
 * direction: masking never protected the password from anything but the person standing behind you,
 * and this panel runs on tablets in shared spaces -- so revealed text stays revealed until the
 * staff member hides it again, rather than being cleverly auto-hidden on a timer they cannot
 * predict.
 */
export interface PasswordInputProps
  extends Omit<InputProps, 'type' | 'prefix' | 'suffix' | 'numeric'> {
  /**
   * Adds a copy-to-clipboard button beside the reveal toggle.
   *
   * Only for a password being HANDED OVER -- the onboarding flow's temporary owner password, whose
   * whole purpose is to be passed to someone else. Not for a credential being entered: there is
   * nothing to copy out of a field you are typing into, and a clipboard is readable by every other
   * app on the device, so the affordance should exist exactly where the workflow needs it.
   */
  copyable?: boolean
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, copyable = false, value, ...rest }, ref) {
    const [revealed, setRevealed] = useState(false)
    const [copied, setCopied] = useState(false)
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(
      () => () => {
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
      },
      [],
    )

    const text = typeof value === 'string' ? value : ''

    const copy = () => {
      const done = () => {
        setCopied(true)
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 1600)
      }
      /*
        `navigator.clipboard` needs a secure context, so it is simply absent over plain http on a
        LAN address -- which is exactly how someone runs this panel while setting a restaurant up.
        The fallback selects the field's text so Ctrl-C still works, which is a real degradation
        rather than a dead button. Revealing it first: selecting masked text copies the value fine
        but shows the user nothing, and a manual copy they cannot see is a manual copy they will
        not trust.
      */
      const fallback = () => {
        setRevealed(true)
        inputRef.current?.select()
      }
      if (!navigator.clipboard?.writeText) {
        fallback()
        return
      }
      navigator.clipboard.writeText(text).then(done, fallback)
    }

    return (
      <div className="relative flex min-w-0 items-stretch">
        <Input
          ref={(node) => {
            inputRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          value={value}
          // Swapping `type` is the standard mechanism and keeps `autoComplete` working, so a password
          // manager still fills and saves the field.
          type={revealed ? 'text' : 'password'}
          // Room for the buttons, so a long password does not run underneath them.
          className={cn(copyable ? 'pr-[5.5rem]' : 'pr-11', className)}
          {...rest}
        />
        {/* Both follow the input in DOM order, so Tab reaches the field first -- which is the
            order someone expects -- and copy before reveal, matching their left-to-right order. */}
        <div className="absolute inset-y-0 right-0 flex items-stretch">
          {copyable ? (
            <button
              type="button"
              onClick={copy}
              // Nothing to put on a clipboard yet, and a button that silently does nothing is worse
              // than one that is visibly unavailable.
              disabled={text === ''}
              aria-label={copied ? 'Password copied' : 'Copy password'}
              className="flex w-11 items-center justify-center text-muted transition-colors hover:text-ink disabled:text-faint"
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-success" strokeWidth={2.5} />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          ) : null}
          <button
            /*
              `type="button"` IS LOAD-BEARING on both of these. A bare <button> inside a <form>
              defaults to `type="submit"`, so without it, revealing or copying the password would
              submit the form it sits in.
            */
            type="button"
            onClick={() => setRevealed((current) => !current)}
            /*
              The NAME changes rather than carrying `aria-pressed`. Both would be redundant, and a
              button whose accessible name states the action it will perform is the pattern
              screen-reader users actually encounter on this control.
            */
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="flex w-11 items-center justify-center rounded-r-control text-muted transition-colors hover:text-ink"
          >
            {revealed ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </div>
        {/*
          Spoken, because a tick appearing in a corner is not feedback for everyone. Rendered only
          when there is a copy button: a non-copyable field was emitting an empty polite live region
          into every sign-in and staff form, which is dead weight now and a thing that announces
          something unintended later.
        */}
        {copyable ? (
          <span aria-live="polite" className="sr-only">
            {copied ? 'Password copied to clipboard' : ''}
          </span>
        ) : null}
      </div>
    )
  },
)
