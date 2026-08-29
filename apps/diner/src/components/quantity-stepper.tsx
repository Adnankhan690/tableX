'use client'

import { cn } from '@tablex/ui'

/**
 * The add / +/- control.
 *
 * Supports default style (e.g. in Cart screen) and 'overlay' style (floating on dish photos in Menu).
 */
export function QuantityStepper({
  quantity,
  onChange,
  disabled,
  max = 99,
  label,
  variant = 'default',
  className,
}: {
  quantity: number
  onChange: (next: number) => void
  disabled?: boolean
  max?: number
  label: string
  variant?: 'default' | 'overlay'
  className?: string
}) {
  if (variant === 'overlay') {
    if (quantity === 0) {
      return (
        <button
          type="button"
          onClick={() => onChange(1)}
          disabled={disabled}
          aria-label={`Add ${label}`}
          className={cn(
            // 72px against a 96px photo, and 32px tall. NARROWER THAN THE IMAGE is the rule: a
            // control that overhangs the thing it sits on reads as broken layout rather than as an
            // overlay, and one that is half the photo's height hides the food.
            'min-w-[4.5rem] h-8 px-3 rounded-xl font-bold text-[0.75rem] tracking-wide shadow-md uppercase',
            'bg-white text-[#e25c63] border border-[#e25c63]/25 hover:bg-[#fff5f5]',
            'flex items-center justify-center gap-1 transition-transform active:scale-95 disabled:opacity-40',
            className,
          )}
        >
          <span>ADD</span>
          <span className="text-base leading-none font-extrabold">+</span>
        </button>
      )
    }

    return (
      <div
        className={cn(
          // 80px, still inside the 96px photo. Wider than ADD because it holds three controls.
          'min-w-[5rem] h-8 rounded-xl shadow-md bg-[#e25c63] text-white flex items-center justify-between px-1.5 font-bold select-none',
          'transition-all',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onChange(quantity - 1)}
          disabled={disabled}
          aria-label={quantity === 1 ? `Remove ${label}` : `One less ${label}`}
          className="flex h-full w-6 items-center justify-center text-base leading-none active:opacity-75 disabled:opacity-40"
        >
          −
        </button>
        <span
          aria-live="polite"
          className="min-w-5 text-center text-xs font-bold tabular-nums text-white"
        >
          {quantity}
        </span>
        <button
          type="button"
          onClick={() => onChange(quantity + 1)}
          disabled={disabled || quantity >= max}
          aria-label={`One more ${label}`}
          className="flex h-full w-6 items-center justify-center text-base leading-none active:opacity-75 disabled:opacity-40"
        >
          +
        </button>
      </div>
    )
  }

  // Default variant
  if (quantity === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        disabled={disabled}
        aria-label={`Add ${label}`}
        className={cn(
          'min-h-tap min-w-[4.25rem] rounded-full border border-accent px-4',
          'text-[0.9375rem] font-semibold text-accent',
          'transition-opacity active:opacity-70 disabled:opacity-40',
          className,
        )}
      >
        Add
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-tap items-center rounded-full bg-accent text-accent-ink',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        disabled={disabled}
        // The label says what it does at this quantity: at 1 it removes the dish entirely,
        // and a screen reader announcing "decrease" would understate that.
        aria-label={quantity === 1 ? `Remove ${label}` : `One less ${label}`}
        className="flex min-h-tap min-w-tap items-center justify-center rounded-l-full text-xl leading-none active:opacity-70 disabled:opacity-40"
      >
        −
      </button>
      <span
        aria-live="polite"
        className="min-w-6 text-center text-[0.9375rem] font-semibold tabular-nums"
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={disabled || quantity >= max}
        aria-label={`One more ${label}`}
        className="flex min-h-tap min-w-tap items-center justify-center rounded-r-full text-xl leading-none active:opacity-70 disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
