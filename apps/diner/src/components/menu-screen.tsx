'use client'

import { isApiError } from '@tablex/api-client'
import type { MenuItemView, MenuResponse } from '@tablex/shared'
import { computeTotals, formatINR, formatRating, MIN_RATINGS_TO_PUBLISH } from '@tablex/shared'
import { cn, EmptyState, ErrorState, FoodTypeBadge, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
   * Search and the veg filter both run over the already-loaded menu, with no extra request.
   * The whole menu is already in memory from one fetch, so a round trip per keystroke would
   * add latency to something that is instant -- and would make the filter unusable on the 3G
   * connection this app is designed for (PRD 7).
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

  /**
   * The dishes diners rate highest, lifted to the top of the menu.
   *
   * Computed from the menu ALREADY IN MEMORY rather than fetched. The whole menu arrives in one
   * response (PRD 7), and asking the server for a ranking it could only build from the same rows
   * would add a round trip to the screen whose latency is a product requirement.
   *
   * Derived from `filtered`, so the veg filter narrows it exactly as it narrows everything else --
   * a vegetarian diner should not be shown a "most loved" list they cannot order from.
   *
   * Four rules, each earning its place:
   *   * `item.rating` present at all. The server withholds a score until a dish has
   *     MIN_RATINGS_TO_PUBLISH ratings, so this inherits that threshold rather than restating it.
   *   * average >= MOST_LOVED_MIN_AVERAGE. "Most loved" has to mean loved. Without a floor this
   *     section becomes "least bad", and on a menu where everything sits at 3.1 it would present
   *     mediocrity as a recommendation.
   *   * available. Leading with a dish the kitchen has run out of is worse than leading with
   *     nothing -- it is the one recommendation guaranteed to disappoint.
   *   * no active search. A diner who typed "paneer" is looking for something specific, and a
   *     recommendations strip above their results is in the way. The veg filter is different: it
   *     narrows, it does not seek.
   */
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
        // Score, then how many people back it, then name. The last two keys are what make the
        // order stable: without them two dishes on 4.6 can swap places between renders, and a
        // list that reshuffles as you scroll reads as a broken page.
        const byScore = (b.rating?.average ?? 0) - (a.rating?.average ?? 0)
        if (byScore !== 0) return byScore
        const byCount = (b.rating?.count ?? 0) - (a.rating?.count ?? 0)
        if (byCount !== 0) return byCount
        return a.name.localeCompare(b.name)
      })
      .slice(0, MOST_LOVED_LIMIT)
  }, [filtered, query])

  /**
   * Locally computed so the bar updates the instant a quantity changes. Display only -- the
   * server re-prices the order at placement, which is why the request carries no amount
   * (docs/DECISIONS.md D7).
   */
  const preview = useMemo(() => {
    if (cart === null || menu === null) return null
    return computeTotals(totalsInput(cart), menu.tax_bps, menu.service_charge_bps)
  }, [cart, menu])

  /**
   * Highlights the category whose section is currently under the header.
   *
   * IntersectionObserver rather than a scroll listener: a scroll handler on a long photo list
   * runs on every frame and is exactly the kind of main-thread work that makes a cheap phone
   * feel slow.
   */
  useEffect(() => {
    if (filtered.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveCategory(visible.target.id.replace('cat-', ''))
      },
      // The top inset clears the sticky header, so a section counts as "current" when it
      // reaches just below it rather than at the very top of the viewport.
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 },
    )

    for (const category of filtered) {
      const node = sectionRefs.current[category.uid]
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [filtered])

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
        // The table label is the most important string on this screen: it is how a diner
        // confirms their food is going to the table they are sitting at.
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
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search dishes"
            aria-label="Search the menu"
            className="min-h-tap flex-1 rounded-full border border-line bg-surface px-4 text-[0.9375rem] outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setVegOnly((value) => !value)}
            aria-pressed={vegOnly}
            className={cn(
              'flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium',
              vegOnly ? 'border-veg bg-veg text-white' : 'border-line bg-surface text-ink',
            )}
          >
            <FoodTypeBadge type="veg" size={13} />
            Veg
          </button>
        </div>

        {/* Category chips. Horizontal scroll rather than a wrapped grid, so the filter row
            keeps a fixed height as the menu grows. */}
        {filtered.length > 1 ? (
          <nav aria-label="Menu categories" className="scroll-x mt-2 flex gap-2 pb-1">
            {filtered.map((category) => (
              <a
                key={category.uid}
                href={`#cat-${category.uid}`}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium',
                  activeCategory === category.uid
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-sunken text-muted',
                )}
              >
                {category.name}
              </a>
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
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
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
                className="scroll-mt-32"
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

/** One dish. Split out so the menu's re-render on a quantity tap stays cheap. */
/**
 * The dish blurb.
 *
 * Extracted rather than inlined because the row already carries six other things and this is the
 * only one that is prose. Clamped to two lines: a long description pushes the price and the rating
 * apart, and those two are what a diner is actually comparing between rows.
 */
function DishDescription({ description }: { description: string }) {
  return <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{description}</p>
}

/**
 * A dish's score on the menu, as one line.
 *
 * One filled star and a number rather than five stars: at this size a five-star row is a
 * cluster of ambiguous shapes on a scrolling list, and the number is what a diner actually
 * reads. The count rides along because "4.6" alone invites the question.
 */
function DishRating({ rating }: { rating: NonNullable<MenuItemView['rating']> }) {
  return (
    <span
      // role="img" with a label, rather than a bare span carrying aria-label -- which is both an
      // accessibility bug and a biome error. The label spells out what "4.8 (12)" means, since
      // read aloud those two numbers are ambiguous.
      role="img"
      aria-label={`Rated ${formatRating(rating.average)} out of 5 by ${rating.count} ${
        rating.count === 1 ? 'diner' : 'diners'
      }`}
      className="flex items-center gap-1 text-[0.8125rem] text-muted"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className="text-accent"
      >
        <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
      </svg>
      <span aria-hidden="true" className="font-medium tabular-nums text-ink">
        {formatRating(rating.average)}
      </span>
      {/*
        How many diners are behind the score. Hidden until hover on a pointer device and simply
        always visible on touch -- see the .rating-count note in globals.css for why that is a
        media query rather than a Tailwind hover: variant.

        The score is the thing a diner is scanning for; the count is what they check before
        trusting it. Showing both at full weight on every row makes a long menu noisier without
        making any single dish clearer.
      */}
      <span aria-hidden="true" className="rating-count tabular-nums">
        ({rating.count})
      </span>
    </span>
  )
}

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
        'rating-hover flex gap-3 border-b border-line px-4 py-3',
        unavailable && 'opacity-55',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <FoodTypeBadge type={item.food_type} size={14} />
          {item.is_bestseller && !unavailable ? (
            <span className="rounded-md bg-amber-100 border border-amber-300/50 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-800">
              Bestseller
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-dish-name">{item.name}</p>

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

        {item.description ? <DishDescription description={item.description} /> : null}

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
