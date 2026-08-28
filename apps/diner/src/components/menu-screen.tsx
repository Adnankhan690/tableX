'use client'

import { isApiError } from '@tablex/api-client'
import type { MenuItemView, MenuResponse } from '@tablex/shared'
import { computeTotals, formatINR, formatRating } from '@tablex/shared'
import { cn, EmptyState, ErrorState, FoodTypeBadge, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
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
export function MenuScreen() {
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
      <div className="sticky top-[3.75rem] z-10 border-b border-line bg-bg px-4 py-2">
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
          filtered.map((category) => (
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
                    onAdd={() => add(item)}
                    onSetQuantity={(next) => setQuantity(item.uid, next)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      {/* The bar appears only once there is something to review, so it does not cover the menu
          while the diner is still browsing. */}
      {count > 0 && preview !== null ? (
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
 * A dish's score on the menu, as one line.
 *
 * One filled star and a number rather than five stars: at this size a five-star row is a
 * cluster of ambiguous shapes on a scrolling list, and the number is what a diner actually
 * reads. The count rides along because "4.6" alone invites the question.
 */
function DishRating({ rating }: { rating: NonNullable<MenuItemView['rating']> }) {
  return (
    <span className="flex items-center gap-1 text-[0.8125rem] text-muted">
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
      <span className="font-medium tabular-nums text-ink">{formatRating(rating.average)}</span>
      <span className="tabular-nums">({rating.count})</span>
    </span>
  )
}

function DishRow({
  item,
  quantity,
  onAdd,
  onSetQuantity,
}: {
  item: MenuItemView
  quantity: number
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

  return (
    <li className={cn('flex gap-3 border-b border-line px-4 py-3', unavailable && 'opacity-55')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <FoodTypeBadge type={item.food_type} size={14} />
          {item.is_bestseller && !unavailable ? (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-accent">
              Bestseller
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-dish-name">{item.name}</p>

        <div className="mt-0.5 flex items-center gap-2">
          <p className="text-price tabular-nums">{item.price.display}</p>
          {/*
            Absent, not zeroed, for a dish without enough ratings -- the server omits the field
            below its publication threshold. A "5.0" from one tap would rank an untried dish
            above a consistently good one, so no score is the honest rendering (PRD 6.2).
          */}
          {item.rating ? <DishRating rating={item.rating} /> : null}
        </div>

        {item.description ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">
            {item.description}
          </p>
        ) : null}

        <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-muted">
          {item.prep_time_mins ? <span>{item.prep_time_mins} min</span> : null}
          {item.spice_level ? <span className="capitalize">{item.spice_level}</span> : null}
        </div>

        {unavailable ? (
          <p className="mt-1 text-[0.8125rem] font-medium text-nonveg">Unavailable today</p>
        ) : null}
      </div>

      <div className="flex flex-col items-end justify-between gap-2">
        <DishImage name={item.name} {...(item.image_url ? { url: item.image_url } : {})} />
        {!unavailable ? (
          <QuantityStepper
            quantity={quantity}
            label={item.name}
            onChange={(next) => (next === 1 && quantity === 0 ? onAdd() : onSetQuantity(next))}
          />
        ) : null}
      </div>
    </li>
  )
}
