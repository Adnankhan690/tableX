'use client'

import { isApiError } from '@tablex/api-client'
import type { MenuItemView, MenuResponse } from '@tablex/shared'
import { computeTotals, formatINR, formatRating, MIN_RATINGS_TO_PUBLISH } from '@tablex/shared'
import { cn, EmptyState, ErrorState, FoodTypeBadge, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, useCallback } from 'react'
import { DishImage } from '@/components/dish-image'
import { useCart, useSession } from '@/components/providers'
import { QuantityStepper } from '@/components/quantity-stepper'
import { BottomBar, ScreenHeader } from '@/components/screen'
import { useGatedSession } from '@/components/session-gate'
import { api } from '@/lib/api'
import { totalsInput } from '@/lib/cart'

/**
 * The menu (PRD 6.2). The screen the diner spends most of their time on.
 */
/**
 * How many dishes the "Most loved" strip carries.
 *
 * Three, not ten. It is a recommendation, and a recommendation of ten things is a menu -- which
 * the diner already has, directly below it.
 */
const MOST_LOVED_LIMIT = 3

/**
 * The score a dish must clear to be called loved.
 *
 * Without a floor the section silently becomes "least bad": on a menu where everything sits
 * around 3.1 it would present mediocrity as a recommendation, which costs more trust than showing
 * no section at all.
 */
const MOST_LOVED_MIN_AVERAGE = 4

export function MenuScreen() {
  // Generated rather than hard-coded, so two MenuScreens on one page could not emit the same id
  // and leave the second section pointing at the first one's heading.
  const mostLovedId = useId()

  const session = useGatedSession()

  const { cart, count, add, setQuantity } = useCart()
  const { clear: clearSession } = useSession()

  const [menu, setMenu] = useState<MenuResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [vegOnly, setVegOnly] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const isManualScrolling = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)

    api
      .getMenu(session.token, controller.signal)
      .then(setMenu)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        // A dead token cannot be recovered from in this screen. Clearing it drops the diner
        // onto the "scan again" gate, which is the only action that helps.
        if (isApiError(err) && err.isSessionError) {
          clearSession()
          return
        }
        setError(err)
      })

    return () => controller.abort()
  }, [session.token, clearSession])

  /**
   * Search and the veg filter both run over the already-loaded menu with zero extra requests.
   */
  const filtered = useMemo(() => {
    if (menu === null) return []
    const needle = query.trim().toLowerCase()

    return menu.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (vegOnly && item.food_type !== 'veg') return false
          if (needle === '') return true
          return (
            item.name.toLowerCase().includes(needle) ||
            (item.description ?? '').toLowerCase().includes(needle)
          )
        }),
      }))
      .filter((category) => category.items.length > 0)
  }, [menu, query, vegOnly])

  // One source for "can anything be ordered right now", so the banner and every row agree.
  const closed = menu !== null && !menu.restaurant.accepting_orders

  const mostLoved = useMemo(() => {
    if (query.trim() !== '') return []

    return filtered
      .flatMap((category) => category.items)
      .filter(
        (item) =>
          item.is_available &&
          item.rating !== undefined &&
          item.rating.count >= MIN_RATINGS_TO_PUBLISH &&
          item.rating.average >= MOST_LOVED_MIN_AVERAGE,
      )
      .sort((a, b) => {
        const byScore = (b.rating?.average ?? 0) - (a.rating?.average ?? 0)
        if (byScore !== 0) return byScore
        const byCount = (b.rating?.count ?? 0) - (a.rating?.count ?? 0)
        if (byCount !== 0) return byCount
        return a.name.localeCompare(b.name)
      })
      .slice(0, MOST_LOVED_LIMIT)
  }, [filtered, query])

  const preview = useMemo(() => {
    if (cart === null || menu === null) return null
    return computeTotals(totalsInput(cart), menu.tax_bps, menu.service_charge_bps)
  }, [cart, menu])

  /**
   * Smoothly scrolls to a category and centers the active category tab horizontally.
   * Locks the IntersectionObserver during scroll so it does not falsely select adjacent categories.
   */
  const handleCategoryClick = useCallback((categoryUid: string) => {
    const section = sectionRefs.current[categoryUid]
    if (!section) return

    setActiveCategory(categoryUid)
    isManualScrolling.current = true
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)

    // Center tab horizontally in the nav bar
    tabRefs.current[categoryUid]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })

    // Offset for the sticky header (~60px header + ~92px search/filter bar = ~152px)
    const headerOffset = 152
    const sectionTop = section.getBoundingClientRect().top + window.scrollY
    const targetTop = Math.max(0, sectionTop - headerOffset)

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    })

    scrollTimeoutRef.current = setTimeout(() => {
      isManualScrolling.current = false
    }, 750)
  }, [])

  /**
   * Highlights the category currently visible beneath the sticky header during natural scrolling.
   */
  useEffect(() => {
    if (filtered.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScrolling.current) return

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]

        if (visible) {
          const uid = visible.target.id.replace('cat-', '')
          setActiveCategory(uid)
        }
      },
      { rootMargin: '-152px 0px -55% 0px', threshold: 0 },
    )

    for (const category of filtered) {
      const node = sectionRefs.current[category.uid]
      if (node) observer.observe(node)
    }

    return () => observer.disconnect()
  }, [filtered])

  /** Auto-center the active category tab pill in horizontal scrollbar when activeCategory changes */
  useEffect(() => {
    if (!activeCategory || isManualScrolling.current) return
    tabRefs.current[activeCategory]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [activeCategory])

  if (error !== null) {
    return (
      <div className="px-4 py-16">
        <ErrorState
          message={isApiError(error) ? error.message : 'Could not load the menu.'}
          {...(isApiError(error) && error.code ? { code: error.code } : {})}
          {...(isApiError(error) && error.requestId ? { requestId: error.requestId } : {})}
          onRetry={() => {
            setError(null)
            setMenu(null)
            api.getMenu(session.token).then(setMenu).catch(setError)
          }}
        />
      </div>
    )
  }

  if (menu === null) {
    return (
      <>
        <ScreenHeader title={session.restaurantName} subtitle={`Table ${session.tableLabel}`} />
        <div className="flex items-center justify-center gap-2 py-24 text-muted">
          <Spinner /> Loading the menu
        </div>
      </>
    )
  }

  return (
    <>
      <ScreenHeader
        title={menu.restaurant.name}
        subtitle={`Table ${session.tableLabel}`}
        right={
          <Link
            href="/orders"
            className="shrink-0 rounded-full px-3 py-2 text-[0.8125rem] font-medium text-accent"
          >
            My orders
          </Link>
        }
      />

      {/* Search and filter, sticky under the header so they stay reachable down a long menu. */}
      <div className="sticky top-[3.75rem] z-20 border-b border-line bg-bg px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dishes..."
              aria-label="Search the menu"
              className="min-h-tap w-full rounded-full border border-line bg-surface pl-10 pr-9 text-[0.9375rem] outline-none placeholder:text-muted focus:border-accent"
            />
            {/* Search Glass Icon */}
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {/* Search Clear Button */}
            {query.length > 0 ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted/20 text-muted hover:bg-muted/30"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Veg Filter Toggle Button */}
          <button
            type="button"
            onClick={() => setVegOnly((cur) => !cur)}
            aria-pressed={vegOnly}
            className={cn(
              'flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8125rem] font-semibold transition-all select-none active:scale-95',
              vegOnly
                ? 'border-emerald-600 bg-emerald-700 text-white shadow-sm'
                : 'border-line bg-surface text-ink hover:border-emerald-600/40',
            )}
          >
            <FoodTypeBadge
              type="veg"
              size={13}
              className={vegOnly ? 'text-white' : undefined}
            />
            <span>Veg</span>
            {/* Mini Toggle Switch Indicator */}
            <span
              aria-hidden="true"
              className={cn(
                'relative ml-0.5 inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors',
                vegOnly ? 'bg-emerald-900/50' : 'bg-line',
              )}
            >
              <span
                className={cn(
                  'inline-block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform',
                  vegOnly ? 'translate-x-3' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        </div>

        {/* Category chips. Horizontal scroll with smooth centered selection and active focus */}
        {filtered.length > 1 ? (
          <nav aria-label="Menu categories" className="scroll-x mt-2 flex gap-2 pb-1">
            {filtered.map((category) => (
              <button
                key={category.uid}
                type="button"
                ref={(el) => {
                  tabRefs.current[category.uid] = el
                }}
                onClick={() => handleCategoryClick(category.uid)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-all duration-200 select-none active:scale-95',
                  activeCategory === category.uid
                    ? 'bg-accent text-accent-ink shadow-sm'
                    : 'bg-surface-sunken text-muted hover:bg-surface hover:text-ink',
                )}
              >
                {category.name}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <main className="pb-bar">
        {/*
          Said BEFORE the menu, not at checkout.

          The server refuses placement when the restaurant is closed (TX_RST_008), but meeting that
          after choosing four dishes is the same information delivered at the worst possible moment.
          The menu stays readable on purpose -- someone looking up what a restaurant serves is a
          perfectly good reason to scan, and hiding it would be worse than saying so.
        */}
        {menu !== null && !menu.restaurant.accepting_orders ? (
          <p
            role="status"
            className="border-b border-line bg-surface-sunken px-4 py-3 text-[0.875rem] leading-snug text-muted"
          >
            <span className="font-semibold text-ink">
              {menu.restaurant.name} is not taking orders right now.
            </span>{' '}
            You can still look through the menu.
          </p>
        ) : null}

        {filtered.length === 0 ? (
          <div className="px-4 py-16">
            <EmptyState
              title={query || vegOnly ? 'Nothing matches' : 'The menu is empty'}
              description={
                query || vegOnly
                  ? 'Try a different search, or turn off the veg filter.'
                  : 'Please ask a staff member to take your order.'
              }
            />
          </div>
        ) : (
          <>
            {/*
              Above the categories, and deliberately NOT a re-sort of them.

              Reordering the menu itself by rating would throw away the restaurant's own
              sort_order -- Starters before Desserts is neither alphabetical nor by score, and it
              is a decision the manager made. A strip on top adds a recommendation without
              destroying the arrangement underneath it.

              The same dish therefore appears twice, here and in its category. That is fine and
              intended: the quantity is read from the cart by uid in both places, so the stepper
              stays in step wherever the diner taps it.
            */}
            {mostLoved.length > 0 ? (
              <section aria-labelledby={mostLovedId} className="border-b border-line">
                <h2
                  id={mostLovedId}
                  className="flex items-center gap-1.5 bg-accent-soft px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-accent"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                    className="text-accent"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  Most loved
                </h2>
                <ul>
                  {mostLoved.map((item) => (
                    <DishRow
                      key={`loved-${item.uid}`}
                      item={item}
                      quantity={cart?.lines.find((l) => l.menuItemUid === item.uid)?.quantity ?? 0}
                      closed={closed}
                      onAdd={() => add(item)}
                      onSetQuantity={(next) => setQuantity(item.uid, next)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {filtered.map((category) => (
              <section
                key={category.uid}
                id={`cat-${category.uid}`}
                ref={(node) => {
                  sectionRefs.current[category.uid] = node
                }}
                className="scroll-mt-[9.5rem]"
              >
                <h2 className="bg-surface-sunken px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
                  {category.name}
                </h2>
                <ul>
                  {category.items.map((item) => (
                    <DishRow
                      key={item.uid}
                      item={item}
                      quantity={cart?.lines.find((l) => l.menuItemUid === item.uid)?.quantity ?? 0}
                      closed={closed}
                      onAdd={() => add(item)}
                      onSetQuantity={(next) => setQuantity(item.uid, next)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>

      {/* The bar appears only once there is something to review, so it does not cover the menu
          while the diner is still browsing. */}
      {count > 0 && preview !== null && !closed ? (
        <BottomBar>
          <Link href="/cart" className="block">
            <div className="flex min-h-tap items-center justify-between rounded-card bg-accent px-4 py-3 text-accent-ink">
              <span className="text-[0.9375rem] font-medium">
                {count} {count === 1 ? 'item' : 'items'}
                <span className="mx-2 opacity-60">·</span>
                <span className="font-semibold tabular-nums">{formatINR(preview.totalMinor)}</span>
              </span>
              <span className="text-[0.9375rem] font-semibold">View cart →</span>
            </div>
          </Link>
        </BottomBar>
      ) : null}
    </>
  )
}

/**
 * A dish's score on the menu, as one line.
 *
 * One filled star and a number rather than five stars: at this size a five-star row is a
 * cluster of ambiguous shapes on a scrolling list, and the number is what a diner actually
 * reads. The count rides along because "4.6" alone invites the question.
 */
/**
 * Dynamic tone based on industry-standard thresholds:
 * - >= 4.0: Deep emerald green (high satisfaction)
 * - 3.5 - 3.9: Warm amber / honey (good)
 * - 3.0 - 3.4: Warm orange (average)
 * - < 3.0: Coral red (below average)
 */
function getRatingTone(score: number) {
  if (score >= 4.0) {
    return {
      badge: 'bg-[#15803d] text-white shadow-emerald-950/10',
    }
  }
  if (score >= 3.5) {
    return {
      badge: 'bg-[#d97706] text-white shadow-amber-950/10',
    }
  }
  if (score >= 3.0) {
    return {
      badge: 'bg-[#ea580c] text-white shadow-orange-950/10',
    }
  }
  return {
    badge: 'bg-[#dc2626] text-white shadow-rose-950/10',
  }
}

function formatRatingCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(count)
}

function DishRating({ rating }: { rating: NonNullable<MenuItemView['rating']> }) {
  const tone = getRatingTone(rating.average)

  return (
    <div
      role="img"
      aria-label={`Rated ${formatRating(rating.average)} out of 5 by ${rating.count} ${
        rating.count === 1 ? 'diner' : 'diners'
      }`}
      className="inline-flex items-center gap-1.5 align-middle select-none"
    >
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-[5px] px-1.5 py-[2px] text-[0.6875rem] font-bold leading-none tracking-tight shadow-sm',
          tone.badge,
        )}
      >
        <span className="tabular-nums leading-none">{formatRating(rating.average)}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0 -translate-y-[0.5px]"
        >
          <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
        </svg>
      </span>
      <span className="text-[0.75rem] text-muted font-medium tabular-nums" aria-hidden="true">
        ({formatRatingCount(rating.count)})
      </span>
    </div>
  )
}

/**
 * The dish blurb, truncated to nine words with the rest a tap away.
 *
 * A BUTTON, not a <p onClick>. It arrived as a paragraph with a click handler, which works for
 * exactly one kind of user: a paragraph is not focusable, so it cannot be reached by keyboard or
 * by a switch device, and a screen reader announces it as static text with no hint that anything
 * happens if you activate it. A button carries all three for free and the styling is unchanged.
 *
 * `aria-expanded` is what makes it legible to a screen reader rather than merely operable, and
 * the label says which dish it belongs to -- a menu of twenty rows otherwise announces twenty
 * identical "show more" buttons with nothing to tell them apart.
 *
 * It deliberately does NOT meet the 44px tap floor the rest of this app holds to. That rule is
 * for controls a diner is aiming at; this is progressive disclosure on a line of prose, and
 * padding it to 44px would put a visible gap through the middle of every dish row. The dish's
 * real controls -- Add, and the stepper -- are unaffected and still meet it.
 */
function DishDescription({ description, name }: { description: string; name: string }) {
  const [expanded, setExpanded] = useState(false)
  const words = useMemo(() => description.trim().split(/\s+/).filter(Boolean), [description])
  const isLong = words.length > 9

  if (!isLong) {
    return (
      <p className="mt-1.5 max-w-[190px] text-[0.8125rem] leading-relaxed text-muted sm:max-w-[220px]">
        {description}
      </p>
    )
  }

  const shortText = words.slice(0, 9).join(' ')
  const remainingText = words.slice(9).join(' ')

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={expanded ? `Show less about ${name}` : `Show more about ${name}`}
      className="mt-1.5 block max-w-[190px] select-none text-left text-[0.8125rem] leading-relaxed text-muted transition-all duration-300 ease-in-out hover:text-ink sm:max-w-[220px]"
    >
      <span>{shortText}</span>
      {expanded ? (
        <span className="transition-opacity duration-300 ease-in-out"> {remainingText}</span>
      ) : (
        <span className="transition-opacity duration-300">…</span>
      )}
    </button>
  )
}

/** One dish. Split out so the menu's re-render on a quantity tap stays cheap. */
function DishRow({
  item,
  quantity,
  closed,
  onAdd,
  onSetQuantity,
}: {
  item: MenuItemView
  quantity: number
  /** The whole restaurant is not taking orders. Distinct from this dish being sold out. */
  closed: boolean
  onAdd: () => void
  onSetQuantity: (next: number) => void
}) {
  /**
   * A sold-out dish is greyed out in place, never hidden. The server returns it with
   * `is_available: false` precisely so this is possible -- a dish that silently vanishes from
   * a menu the diner was just looking at reads as a broken page, where "Unavailable" reads as
   * a restaurant that ran out.
   */
  const unavailable = !item.is_available

  /**
   * Two different reasons a dish cannot be added, kept apart on purpose.
   *
   * A closed restaurant does NOT get the "Unavailable today" label -- that means the kitchen ran
   * out of this dish, and stamping it on all forty would be a lie the diner can disprove by
   * reading it. The banner at the top of the menu already says why, once, in the right words.
   *
   * The Add control disappears either way, matching how a sold-out dish behaves: an addable
   * control that cannot result in an order is worse than no control.
   */
  const addable = !unavailable && !closed

  return (
    <li
      className={cn(
        'rating-hover flex gap-3.5 border-b border-line px-4 pt-4 pb-6 items-start justify-between',
        unavailable && 'opacity-55',
      )}
    >
      <div className="min-w-0 flex-1 pr-2">
        <div className="flex items-center gap-2">
          <FoodTypeBadge type={item.food_type} size={15} />
          {item.is_bestseller && !unavailable ? (
            <span className="rounded-md bg-amber-100 border border-amber-300/50 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-800">
              Bestseller
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 text-dish-name font-bold text-ink leading-tight">{item.name}</p>

        <p className="mt-1 text-base font-bold tabular-nums text-ink">{item.price.display}</p>

        {/*
          Rating directly under the price, which is where every food app puts it -- the two are
          read as one unit when deciding.

          Absent, not zeroed, for a dish without enough ratings: the server omits the field below
          its publication threshold. A "5.0" from one tap would rank an untried dish above a
          consistently good one, so no score is the honest rendering (PRD 6.2).
        */}
        {item.rating ? (
          <div className="mt-1">
            <DishRating rating={item.rating} />
          </div>
        ) : null}

        {item.description ? (
          <DishDescription description={item.description} name={item.name} />
        ) : null}

        <div className="mt-1.5 flex items-center gap-2 text-[0.75rem] text-muted">
          {item.prep_time_mins ? <span>{item.prep_time_mins} min</span> : null}
          {item.spice_level ? <span className="capitalize">{item.spice_level}</span> : null}
        </div>

        {unavailable ? (
          <p className="mt-1.5 text-[0.8125rem] font-medium text-nonveg">Unavailable today</p>
        ) : null}
      </div>

      {/*
        `self-start` is load-bearing, not tidiness. This is a flex child, so without it the
        default `align-items: stretch` makes it as tall as the whole row -- and the stepper's
        `-bottom-3` then anchors to the bottom of the row rather than to the photo, leaving it
        floating a hundred pixels below the image it is supposed to sit on.

        `relative` is what the overlay positions against, and `mb-3` is what stops it colliding
        with the row divider: it hangs 12px below the photo, which is exactly the row's padding.
      */}
      <div className="relative mb-3 shrink-0 self-start">
        {/*
          96, not the 76 default. An overlaid control needs a photo big enough to still read as a
          photo underneath it -- at 76 the button was wider than the image and covered a third of
          it, which is worse than no photo at all. Passed here rather than changed in DishImage,
          because the cart and order screens show the same component at thumbnail size with nothing
          on top of it.
        */}
        <DishImage
          name={item.name}
          size={96}
          {...(item.image_url ? { url: item.image_url } : {})}
        />
        {/*
          `addable`, not `!unavailable`. The two differ when the restaurant itself is closed
          (DECISIONS.md D18) -- a sold-out dish and a shut kitchen both mean "cannot be ordered",
          and only one of them is about this dish.
        */}
        {addable ? (
          <div className="absolute -bottom-3 left-1/2 z-[1] -translate-x-1/2">
            <QuantityStepper
              quantity={quantity}
              label={item.name}
              variant="overlay"
              onChange={(next) => (next === 1 && quantity === 0 ? onAdd() : onSetQuantity(next))}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}
