import { FOOD_TYPE_LABEL, FOOD_TYPE_TONE, type FoodType } from '@tablex/shared'
import { cn } from './cn'

type FoodTone = (typeof FOOD_TYPE_TONE)[FoodType]

/**
 * Fallbacks are the conventional packaging colours; an app overrides them per theme without
 * touching this file.
 */
const TONE_CLASS: Record<FoodTone, string> = {
  veg: 'text-[var(--tx-food-veg,#0f7b34)]',
  nonveg: 'text-[var(--tx-food-nonveg,#a01818)]',
  egg: 'text-[var(--tx-food-egg,#b45309)]',
}

export interface FoodTypeBadgeProps {
  type: FoodType
  /** Edge length in px. Defaults to the size that sits level with body copy. */
  size?: number
  withLabel?: boolean
  className?: string
}

/**
 * The veg / non-veg / egg marker (PRD 6.2).
 *
 * Drawn as the square-outline-with-centred-dot used on Indian packaging rather than a "Veg"
 * text label, for two reasons. Diners have been reading that symbol for decades, so it
 * registers without being read -- which is what a menu being scanned needs, as opposed to
 * one being studied. And a word is language-bound: this ships in Hindi too (PRD 7), so a
 * label would need translating where the symbol would not.
 *
 * Colour is never the sole carrier of the distinction. The marker always exposes an
 * accessible name and `withLabel` puts the word on screen, because green-against-red is
 * precisely the pair a red-green colour-blind diner cannot separate (WCAG 1.4.1) -- and
 * ordering the wrong dish here is not a cosmetic failure.
 */
export function FoodTypeBadge({
  type,
  size = 14,
  withLabel = false,
  className,
}: FoodTypeBadgeProps) {
  const label = FOOD_TYPE_LABEL[type]
  const tone = FOOD_TYPE_TONE[type]

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 align-middle', TONE_CLASS[tone], className)}
      data-food-type={type}
      data-tone={tone}
    >
      {/*
        With the word alongside, the glyph is decorative -- naming it too would make a screen
        reader announce "Veg Veg". Standalone, it is the only thing carrying the meaning.
      */}
      <svg
        className="shrink-0"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        role={withLabel ? undefined : 'img'}
        aria-label={withLabel ? undefined : label}
        aria-hidden={withLabel ? true : undefined}
      >
        {withLabel ? null : <title>{label}</title>}
        <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        {/*
          Egg has no statutory symbol in India, so it borrows the same geometry and is
          separated by colour plus its accessible name -- inventing a third shape would mean
          teaching diners a glyph nothing else in the market uses.
        */}
        <circle cx="8" cy="8" r="3.4" fill="currentColor" />
      </svg>
      {withLabel ? <span className="text-xs font-medium">{label}</span> : null}
    </span>
  )
}
