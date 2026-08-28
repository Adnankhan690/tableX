'use client'

import { cn, Spinner } from '@tablex/ui'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-outline'
  | 'danger-quiet'
export type ButtonSize = 'sm' | 'md'

/**
 * DISABLED IS A TOKEN SWAP, NEVER AN OPACITY.
 *
 * `disabled:opacity-40` was used on 19 controls across this panel, and it fades the label
 * together with the fill: white-on-accent became white-on-pale-blue at 1.9:1, so the "Add",
 * "Update password" and "Save settings" buttons were illegible in the state they OPEN in. A
 * disabled control still has to say what it does -- that sentence is the whole reason a manager
 * knows what to type. So every variant below swaps to the sunken surface with muted ink (4.5:1+)
 * and keeps the text readable.
 *
 * Opacity is also not available here for a second reason: Tailwind opacity modifiers do not work
 * on CSS-variable colours (see tailwind.config.ts), so `bg-accent/40` produces nothing at all.
 */
const DISABLED =
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-muted disabled:shadow-none'

const VARIANT: Record<ButtonVariant, string> = {
  // Exactly one of these per surface. If a screen has two filled buttons, one of them is lying
  // about its importance.
  primary:
    'border border-accent bg-accent text-accent-ink shadow-card hover:border-accent-hover hover:bg-accent-hover active:bg-accent-hover',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-muted hover:bg-surface-sunken active:bg-surface-sunken',
  ghost:
    'border border-transparent bg-transparent text-muted hover:bg-surface-sunken hover:text-ink',
  // Filled danger is reserved for a confirmation inside a dialog -- the point where the user has
  // already said what they intend. A destructive action on a list row uses danger-quiet, so a
  // board of eight rows is not eight red buttons competing with the work.
  danger:
    'border border-danger bg-danger text-accent-ink shadow-card hover:border-danger-hover hover:bg-danger-hover',
  // Outlined, for a refusal that sits beside the primary at equal size -- on the order card, where
  // a staff member needs to see all the moves at once. `bg-surface` and not transparent: the card
  // may be tinted, and a see-through button on a pink card loses its shape.
  'danger-outline':
    'border border-danger bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft',
  'danger-quiet':
    'border border-transparent bg-transparent text-danger hover:border-danger-line hover:bg-danger-soft',
}

const SIZE: Record<ButtonSize, string> = {
  // Both clear the panel's tap floor: it is used on a tablet at arm's length, so `sm` is a
  // narrower button, not a shorter one.
  //
  // Below the `sm` breakpoint both drop to the 36px `tap-sm` floor with one step less padding and
  // one step smaller type -- see the note on the tokens in tailwind.config.ts. The height is the
  // smallest part of that change on purpose; the padding and type are what made a 40px button look
  // oversized on a 360px screen.
  sm: 'min-h-tap-sm px-2 text-xs sm:min-h-tap sm:px-2.5 sm:text-sm',
  md: 'min-h-tap-sm px-3 text-sm sm:min-h-tap sm:px-3.5 sm:text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Swaps the label for a spinner and the busy label, and disables the button. */
  loading?: boolean
  /** Present tense, e.g. "Accepting…". Shown while `loading`; falls back to the label. */
  loadingLabel?: string
  /** Inline SVG, 16px. No icon library ships in this app (docs/CONTRIBUTING.md). */
  icon?: ReactNode
  /** Stretches to the container, for a form's submit or a card footer. */
  block?: boolean
}

/**
 * The panel's only button.
 *
 * `type="button"` is the default rather than the browser's `submit`: most buttons here sit inside
 * a form-shaped card but act on their own, and an accidental submit reloads a page mid-service.
 * A real submit passes type="submit" explicitly.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel,
    icon,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-variant={variant}
      data-loading={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium',
        // 120ms: fast enough to feel like the control responded to the press rather than
        // animating afterwards.
        'transition-colors duration-100',
        SIZE[size],
        VARIANT[variant],
        DISABLED,
        block ? 'w-full' : '',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      <span className="truncate">{loading ? (loadingLabel ?? children) : children}</span>
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'block'> {
  /** Required: an icon-only control with no accessible name is invisible to a screen reader. */
  label: string
  icon: ReactNode
}

/** An icon-only control. Square, still 40px, and never without a name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', className, disabled, loading, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      data-variant={variant}
      className={cn(
        'inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-control',
        'transition-colors duration-100',
        VARIANT[variant],
        DISABLED,
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
    </button>
  )
})
