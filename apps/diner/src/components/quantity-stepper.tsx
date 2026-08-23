'use client'

import { cn } from '@tablex/ui'

/**
 * The add / +/- control.
 *
 * Collapses to a single "Add" button at zero rather than showing a disabled minus. The
 * collapsed state is a much larger tap target, which matters because this is the control the
 * whole product funnels through and it is pressed with a thumb while holding a phone.
 */
export function QuantityStepper({
  quantity,
  onChange,
  disabled,
  max = 99,
  label,
}: {
  quantity: number
  onChange: (next: number) => void
  disabled?: boolean
  max?: number
  label: string
}) {
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
        )}
      >
        Add
      </button>
    )
  }

  return (
    <div className="flex min-h-tap items-center rounded-full bg-accent text-accent-ink">
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
