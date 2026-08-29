import { formatINR } from '@tablex/shared'
import { cn } from '@tablex/ui'
import { StarGlyph, VegMark } from './glyphs'
import { MockDescription } from './shell'

/**
 * The diner's menu screen, redrawn as a static illustration.
 *
 * This is the page's substitute for a logo wall: the honest proof a new product can offer is the
 * product itself, so the hero shows the real screen rather than a claim about it. It mirrors
 * `ScreenHeader`, `menu-screen.tsx` and `DishRow` structurally — same order of elements, same
 * `FoodTypeBadge` geometry, same overlay Add pill — so it stays true as those change.
 *
 * Every dish, price and flag below is a real row from `local_seed.sql`, and the four placeholder
 * tints are what `dish-image.tsx`'s hash actually produces for those four names (verified by
 * running the algorithm, not picked by eye).
 *
 * ONE SCALING KNOB: the screen wrapper sets a font size and every internal dimension is authored
 * in `em`. Moving this mock between breakpoints is one number, not forty.
 */

interface Dish {
  name: string
  desc: string
  tone: 'veg' | 'nonveg'
  priceMinor: number
  rating?: string
  bestseller?: boolean
  tint: string
  initials: string
  meta: string
  control: 'add' | 'stepper' | 'none'
  soldOut?: boolean
}

/**
 * Prices are `price_minor` from the seed, rendered through the real `formatINR`. That is why they
 * read "₹280.00" and not "₹280": the product always shows two decimals, and a landing page that
 * quietly formatted money differently from the app would be advertising a bug.
 */
const DISHES: readonly Dish[] = [
  {
    name: 'Paneer Tikka',
    desc: 'Cottage cheese marinated in yoghurt and spices, char-grilled',
    tone: 'veg',
    priceMinor: 28000,
    rating: '4.8',
    bestseller: true,
    tint: 'bg-[#dfe6d5] text-[#4e6238]',
    initials: 'PT',
    meta: '18 min · Medium',
    control: 'add',
  },
  {
    name: 'Butter Chicken',
    desc: 'The classic — tomato, butter, kasuri methi',
    tone: 'nonveg',
    priceMinor: 38000,
    rating: '4.9',
    bestseller: true,
    tint: 'bg-[#eddad5] text-[#7d4a3f]',
    initials: 'BC',
    meta: '22 min · Mild',
    control: 'stepper',
  },
  {
    name: 'Paneer Butter Masala',
    desc: 'Tomato and cashew gravy, mildly sweet',
    tone: 'veg',
    priceMinor: 30000,
    tint: 'bg-[#e9dcc6] text-[#70562c]',
    initials: 'PB',
    meta: '18 min · Mild',
    control: 'add',
  },
  {
    name: 'Kadai Paneer',
    desc: 'Bell peppers, onion, freshly ground kadai masala',
    tone: 'veg',
    priceMinor: 30000,
    tint: 'bg-[#dbe1ea] text-[#465468]',
    initials: 'KP',
    meta: '18 min · Medium',
    control: 'none',
    soldOut: true,
  },
]

/**
 * The cart total, derived rather than typed.
 *
 * 28000 + 38000 + 30000 = 96000 subtotal; Spice Garden is tax_bps 500, service_charge_bps 0, so
 * GST is 4800 and the total is 100800 → ₹1,008.00, which also exercises Indian digit grouping.
 * Computed here so a price edit above cannot leave the bar lying — a landing page whose own
 * arithmetic is wrong is the worst possible advertisement for a product that sells server-side
 * pricing.
 */
const CART_SUBTOTAL_MINOR = 28000 + 38000 + 30000
const CART_TOTAL_MINOR = CART_SUBTOTAL_MINOR + Math.round((CART_SUBTOTAL_MINOR * 500) / 10_000)

export function PhoneMock({ className }: { className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <div
        aria-hidden="true"
        className={cn(
          'rounded-[2.2rem] bg-ink p-[9px]',
          // --tx-ink written as a channel triple, which is legitimate here for exactly the reason
          // tailwind.config.ts gives: the token holds a whole colour and cannot take an opacity
          // modifier, so a tinted shadow has to spell the channels out.
          'shadow-[0_16px_36px_-20px_rgb(28_25_23/0.30)]',
        )}
      >
        {/* A speaker slot and nothing else. No notch and no home indicator: it should read as
            "a phone", not as one manufacturer's phone. */}
        <div className="mx-auto mb-1.5 h-[5px] w-[86px] rounded-full bg-white/25" />
        <div className="relative aspect-[9/18.5] overflow-hidden rounded-[1.7rem] bg-bg text-[11px] md:text-[12px]">
          <StatusBar />
          <Header />
          <SearchRow />
          <CategoryChips />
          <MostLovedBar />
          {DISHES.map((dish) => (
            <DishRow key={dish.name} dish={dish} />
          ))}
          <CartBar />
        </div>
      </div>
      <MockDescription>
        A phone showing the Spice Garden menu at Table 4: Paneer Tikka, vegetarian, ₹280.00; Butter
        Chicken, non-vegetarian, ₹380.00; Paneer Butter Masala, vegetarian, ₹300.00; Kadai Paneer,
        vegetarian, ₹300.00, unavailable today. A cart bar totals 3 items at ₹1,008.00.
      </MockDescription>
    </div>
  )
}

function StatusBar() {
  return (
    <div className="flex h-[1.6em] items-center justify-between px-[1em] text-[0.78em] text-muted">
      <span className="tabular-nums">9:41</span>
      <span className="flex items-center gap-[0.35em]">
        <svg
          aria-hidden="true"
          width="11"
          height="9"
          viewBox="0 0 16 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <path d="M1 4.2a10 10 0 0 1 14 0" />
          <path d="M3.6 7a6.4 6.4 0 0 1 8.8 0" />
          <path d="M6.2 9.8a2.7 2.7 0 0 1 3.6 0" />
        </svg>
        <svg
          aria-hidden="true"
          width="16"
          height="9"
          viewBox="0 0 22 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <rect x="0.6" y="0.6" width="18" height="10.8" rx="2.4" />
          <rect
            x="2.2"
            y="2.2"
            width="12"
            height="7.6"
            rx="1.2"
            fill="currentColor"
            stroke="none"
          />
          <path d="M20.6 4.2v3.6" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
      </span>
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-[0.6em] border-b border-line px-[1em] py-[0.7em]">
      <div className="min-w-0 flex-1">
        {/* The table label is the most important thing on this screen -- a diner confirming they
            are ordering to the table they are sitting at. screen.tsx says so at length. */}
        <p className="truncate font-display text-[1.15em] font-semibold leading-tight text-ink">
          Spice Garden
        </p>
        <p className="truncate text-[0.85em] leading-tight text-muted">Table 4</p>
      </div>
      <span className="shrink-0 text-[0.85em] font-medium text-accent">My orders</span>
    </div>
  )
}

function SearchRow() {
  return (
    <div className="flex gap-[0.5em] border-b border-line px-[1em] py-[0.5em]">
      <div className="flex h-[2em] flex-1 items-center rounded-full border border-line px-[0.8em] text-[0.85em] text-muted">
        Search dishes
      </div>
      <div className="flex h-[2em] shrink-0 items-center gap-[0.35em] rounded-full border border-line px-[0.6em] text-[0.8em] font-medium text-ink">
        <VegMark size={10} />
        Veg
      </div>
    </div>
  )
}

function CategoryChips() {
  return (
    // Clipped at the right edge so the last chip is half-cut: a horizontally scrollable strip
    // that ends flush reads as a complete list, which is exactly the wrong signal.
    <div className="flex gap-[0.4em] overflow-hidden px-[1em] py-[0.5em] text-[0.8em]">
      <span className="shrink-0 rounded-full bg-accent px-[0.7em] py-[0.25em] font-medium text-accent-ink">
        Starters
      </span>
      {['Main Course', 'Biryani', 'Breads'].map((c) => (
        <span
          key={c}
          className="shrink-0 rounded-full bg-surface-sunken px-[0.7em] py-[0.25em] text-muted"
        >
          {c}
        </span>
      ))}
    </div>
  )
}

function MostLovedBar() {
  return (
    <div className="flex items-center gap-[0.4em] bg-accent-soft px-[1em] py-[0.4em] text-[0.72em] font-semibold uppercase tracking-wide text-accent">
      <StarGlyph size={10} />
      Most loved
    </div>
  )
}

function DishRow({ dish }: { dish: Dish }) {
  return (
    <div
      className={cn(
        'flex gap-[0.7em] border-b border-line px-[1em] py-[0.7em]',
        // Sold out is greyed AND labelled. Colour is never the only carrier, and a dish that
        // silently vanished would read as a broken website rather than as a sold-out dish.
        dish.soldOut && 'opacity-55',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[0.4em]">
          <VegMark tone={dish.tone} size={9} />
          {dish.bestseller ? (
            <span className="rounded-full bg-accent-soft px-[0.45em] py-[0.1em] text-[0.62em] font-semibold uppercase tracking-wide text-accent">
              Bestseller
            </span>
          ) : null}
        </div>
        <p className="mt-[0.25em] truncate text-[0.95em] font-semibold leading-tight text-ink">
          {dish.name}
        </p>
        <div className="mt-[0.2em] flex items-center gap-[0.5em]">
          <span className="text-[0.95em] font-bold tabular-nums text-ink">
            {formatINR(dish.priceMinor)}
          </span>
          {dish.rating ? (
            <span className="flex items-center gap-[0.2em] text-[0.8em] text-ink">
              <StarGlyph size={9} className="text-accent" />
              <span className="tabular-nums">{dish.rating}</span>
            </span>
          ) : null}
        </div>
        <p className="mt-[0.25em] line-clamp-2 text-[0.78em] leading-[1.35] text-muted">
          {dish.desc}
        </p>
        <p className="mt-[0.25em] text-[0.72em] text-muted">
          {dish.soldOut ? (
            <span className="font-medium text-nonveg">Unavailable today</span>
          ) : (
            dish.meta
          )}
        </p>
      </div>
      <div className="relative mb-[0.9em] shrink-0 self-start">
        <div
          className={cn(
            'flex h-[3.4em] w-[3.4em] items-center justify-center rounded-2xl font-bold tracking-wider',
            dish.tint,
          )}
        >
          <span className="text-[1.1em] opacity-80">{dish.initials}</span>
        </div>
        {/* The Add control overlaps the image's bottom edge, exactly where
            QuantityStepper variant="overlay" sits on the real screen. */}
        {dish.control === 'add' ? (
          <span className="absolute -bottom-[0.7em] left-1/2 -translate-x-1/2 rounded-full bg-accent px-[0.8em] py-[0.2em] text-[0.75em] font-semibold text-accent-ink">
            + Add
          </span>
        ) : null}
        {dish.control === 'stepper' ? (
          <span className="absolute -bottom-[0.7em] left-1/2 flex -translate-x-1/2 items-center gap-[0.5em] rounded-full bg-accent px-[0.6em] py-[0.2em] text-[0.75em] font-semibold text-accent-ink">
            <span>−</span>
            <span className="tabular-nums">1</span>
            <span>+</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

function CartBar() {
  return (
    <div className="absolute inset-x-[0.7em] bottom-[0.7em] flex items-center justify-between rounded-[0.8em] bg-accent px-[0.9em] py-[0.6em] text-[0.9em] text-accent-ink">
      <span>
        3 items · <span className="font-semibold tabular-nums">{formatINR(CART_TOTAL_MINOR)}</span>
      </span>
      <span className="font-semibold">View cart →</span>
    </div>
  )
}
