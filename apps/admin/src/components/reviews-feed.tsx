'use client'

import { isApiError } from '@tablex/api-client'
import type {
  RatedDishView,
  RatingSummary,
  ReviewSummaryResponse,
  ReviewView,
  StaffServiceReviewView,
} from '@tablex/shared'
import { formatRating, isLowRating, REVIEW_TAG_LABEL, SERVICE_TAG_LABEL } from '@tablex/shared'
import { cn } from '@tablex/ui'
import { MessageSquare, Star, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  Skeleton,
  ToggleChip,
  Toolbar,
} from '@/components/ui'
import { useAdminStream } from '@/hooks/useAdminStream'
import { api } from '@/lib/api'

/** How many reviews a page carries. Enough to scan a service without paging. */
const PER_PAGE = 50

/** The feed's filters. Kept as one value rather than three booleans so they cannot contradict. */
type Filter = 'all' | 'low' | 'commented'

/**
 * Which set of ratings the list is showing.
 *
 * A SEPARATE axis from Filter, and rendered as its own chip group, because the two are different
 * kinds of choice: this picks the dataset, Filter narrows whichever one is picked. Collapsing them
 * into one row of chips would let "Service" and "With a note" look like alternatives when they
 * compose.
 */
type Dataset = 'food' | 'service'

/**
 * What the restaurant reads back (PRD 6.5).
 *
 * The screen is built around one question a manager actually has mid-service -- "is anyone
 * unhappy right now" -- which is why `low` is a first-class filter rather than something to
 * construct, and why the feed updates live. A complaint read the next morning is a record; the
 * same complaint read while the table is still sitting there is something that can be fixed.
 */
export function ReviewsFeed() {
  const { auth } = useAuth()
  const token = auth?.accessToken ?? null

  // The dish drill-down arrives in the URL, set by the rating link on the menu manager. Held
  // in the query string rather than in state so the filtered view is a real page a manager can
  // bookmark or send to a chef, and so the back button undoes it.
  const searchParams = useSearchParams()
  const dishUid = searchParams.get('menu_item_uid')

  const [filter, setFilter] = useState<Filter>('all')
  const [dataset, setDataset] = useState<Dataset>('food')
  const [reviews, setReviews] = useState<ReviewView[] | null>(null)
  const [serviceReviews, setServiceReviews] = useState<StaffServiceReviewView[] | null>(null)
  const [summary, setSummary] = useState<ReviewSummaryResponse | null>(null)
  const [error, setError] = useState<unknown>(null)

  const query = useMemo(() => {
    // The dish drill-down is meaningless on the service feed, and the endpoint does not accept it.
    const dish = dishUid && dataset === 'food' ? { menu_item_uid: dishUid } : {}
    switch (filter) {
      case 'low':
        // A ceiling, not an exact value: "3 and below" is the real question. Nobody wants to
        // look at exactly-two-star reviews.
        return { per_page: PER_PAGE, max_rating: 3, ...dish }
      case 'commented':
        return { per_page: PER_PAGE, has_comment: true, ...dish }
      default:
        return { per_page: PER_PAGE, ...dish }
    }
  }, [dataset, dishUid, filter])

  const load = useCallback(() => {
    if (!token) return

    // Only the visible dataset is fetched. Loading both on every poll would double the request
    // rate on a screen that refreshes live, to populate a list nobody is looking at.
    if (dataset === 'service') {
      api
        .listServiceReviews(token, query)
        .then((page) => {
          setServiceReviews(page.reviews)
          setError(null)
        })
        .catch((err: unknown) => setError(err))
    } else {
      api
        .listReviews(token, query)
        .then((page) => {
          setReviews(page.reviews)
          setError(null)
        })
        .catch((err: unknown) => setError(err))
    }

    // Fetched alongside rather than after: the two describe the same moment, and loading the
    // summary only once would leave the headline score stale as reviews arrive live.
    api
      .reviewSummary(token)
      .then(setSummary)
      .catch(() => {
        /* The panel is a summary of the list below it; losing it must not fail the screen. */
      })
  }, [dataset, query, token])

  useEffect(() => {
    load()
  }, [load])

  // The same socket the order board uses. A rating publishes on the restaurant topic, so this
  // screen sees it without any new transport (docs/DECISIONS.md D10).
  const { live } = useAdminStream(token, load)

  // The visible list, resolved once. Discriminated by `item_name` at the render site rather than
  // by a `kind` field: the two response types are genuinely different shapes, and the presence of
  // a dish is what tells them apart.
  const rows: (ReviewView | StaffServiceReviewView)[] | null =
    dataset === 'service' ? serviceReviews : reviews

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="What diners said about the food and the service, newest first"
        meta={
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success' : 'bg-faint')}
            />
            {live ? 'Live' : 'Polling'}
          </span>
        }
      />

      {/*
        The drill-down banner. Shown INSTEAD of the summary panel, not above it: the panel
        describes the whole restaurant, and leaving it on screen next to one dish's reviews
        invites reading its average as that dish's.
      */}
      {dishUid ? (
        <DishFilterBanner name={reviews?.[0]?.item_name ?? null} />
      ) : summary ? (
        <SummaryPanel summary={summary} />
      ) : null}

      <Toolbar>
        {/* The dataset axis, separated by a rule from the filters that narrow it -- they compose
            rather than compete, and one undivided row of chips would suggest otherwise. */}
        <ToggleChip active={dataset === 'food'} onClick={() => setDataset('food')}>
          Food
        </ToggleChip>
        <ToggleChip active={dataset === 'service'} onClick={() => setDataset('service')}>
          Service
        </ToggleChip>

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-divider" />

        <ToggleChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </ToggleChip>
        <ToggleChip
          active={filter === 'low'}
          // The badge is a count of things somebody should act on, which is exactly what this
          // filter holds. Urgent only when it is non-zero -- an empty queue that shouts is how
          // staff learn to stop reading badges.
          {...(summary
            ? { count: lowRatingCount(summary, dataset), countTone: 'urgent' as const }
            : {})}
          onClick={() => setFilter('low')}
        >
          Needs attention
        </ToggleChip>
        <ToggleChip active={filter === 'commented'} onClick={() => setFilter('commented')}>
          With a note
        </ToggleChip>
      </Toolbar>

      {/*
        A real <main>, matching every other screen in this panel. It was a bare <div>, which
        left the page with no main landmark for a screen reader to jump to -- the one piece of
        page structure that is invisible until someone navigates by landmarks and then is the
        only way around.
      */}
      <main className="space-y-3 p-4">
        {error !== null ? (
          <Notice tone="danger" title="Could not load reviews">
            {isApiError(error) ? error.message : 'Something went wrong. Try again in a moment.'}
          </Notice>
        ) : null}

        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Star}
            title={emptyTitle(filter, dataset)}
            description={emptyDescription(filter, dataset)}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) =>
              'item_name' in row ? (
                <li key={row.uid}>
                  <ReviewRow review={row} />
                </li>
              ) : (
                <li key={row.uid}>
                  <ServiceReviewRow review={row} />
                </li>
              ),
            )}
          </ul>
        )}
      </main>
    </>
  )
}

/**
 * The "you are looking at one dish" banner.
 *
 * Names the dish from the rows rather than from the URL, which carries only a uid. Falls back
 * to the generic wording while the page is loading or when the dish has no reviews at all --
 * fetching the menu purely to resolve a name would be a second request for a heading.
 */
function DishFilterBanner({ name }: { name: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-accent-soft px-4 py-2.5">
      <p className="text-sm text-ink">
        Showing reviews of <span className="font-semibold">{name ?? 'one dish'}</span>
      </p>
      <Link
        href="/reviews"
        className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        Show all reviews
      </Link>
    </div>
  )
}

/** One review. */
function ReviewRow({ review }: { review: ReviewView }) {
  const low = isLowRating(review.rating)

  return (
    <Card
      className={cn(
        // A low rating is tinted rather than badged. The point of this screen is that a manager
        // scanning it finds the problems without reading, and a row of identical white cards
        // makes them read every one.
        low && 'border-danger-line bg-danger-soft',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Stars rating={review.rating} />
            <span className="truncate text-base font-semibold text-ink">{review.item_name}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {/* The order NUMBER, because that is what staff shout across a kitchen and what
                finds the ticket. A uid is unusable for that (docs/DECISIONS.md D9). */}
            {review.order_number}
            {review.table_label ? (
              <>
                <span className="mx-1.5">·</span>Table {review.table_label}
              </>
            ) : null}
            <span className="mx-1.5">·</span>
            <time dateTime={review.created_at}>
              {new Date(review.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </p>
        </div>
      </div>

      {review.tags && review.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.tags.map((tag) => (
            <Badge key={tag} tone={low ? 'danger' : 'neutral'}>
              {REVIEW_TAG_LABEL[tag]}
            </Badge>
          ))}
        </div>
      ) : null}

      {review.comment ? (
        <p className="mt-2 flex gap-1.5 text-sm leading-snug text-ink">
          <MessageSquare
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
            strokeWidth={1.75}
          />
          <span>{review.comment}</span>
        </p>
      ) : null}
    </Card>
  )
}

/**
 * One service rating.
 *
 * A separate component from ReviewRow rather than one with conditional fields. The two really do
 * render different things -- this has no dish to name and no menu to link into -- and a single
 * component branching on which half it holds is how both halves end up slightly wrong.
 */
function ServiceReviewRow({ review }: { review: StaffServiceReviewView }) {
  const low = isLowRating(review.rating)

  return (
    <Card className={cn(low && 'border-danger-line bg-danger-soft')}>
      <div className="flex items-center gap-2">
        <Stars rating={review.rating} />
        <span className="text-base font-semibold text-ink">Service</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {review.order_number}
        {review.table_label ? (
          <>
            <span className="mx-1.5">·</span>Table {review.table_label}
          </>
        ) : null}
        <span className="mx-1.5">·</span>
        <time dateTime={review.created_at}>
          {new Date(review.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </p>

      {review.tags && review.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.tags.map((tag) => (
            <Badge key={tag} tone={low ? 'danger' : 'neutral'}>
              {SERVICE_TAG_LABEL[tag]}
            </Badge>
          ))}
        </div>
      ) : null}

      {review.comment ? (
        <p className="mt-2 flex gap-1.5 text-sm leading-snug text-ink">
          <MessageSquare
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
            strokeWidth={1.75}
          />
          <span>{review.comment}</span>
        </p>
      ) : null}
    </Card>
  )
}

/**
 * The headline panel.
 *
 * The distribution sits beside the average rather than under it, because the two answer
 * different questions and a manager needs both at once: a 3.0 built from straight 3s is a dull
 * menu, and a 3.0 built from 5s and 1s is an inconsistent kitchen. Those need opposite
 * responses, and an average alone cannot tell them apart.
 */
function SummaryPanel({ summary }: { summary: ReviewSummaryResponse }) {
  if (summary.food.count === 0 && summary.service.count === 0) {
    return (
      <div className="border-b border-line bg-surface px-4 py-3">
        <p className="text-sm text-muted">
          No ratings yet. They appear here as diners leave them — the prompt reaches a diner once
          their food has arrived.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 border-b border-line bg-surface p-4 lg:grid-cols-2">
      {/*
        Two numbers, side by side, never averaged together. A blended score points at nobody:
        "you are a 3.8" is not something a manager can act on, where "food 4.6, service 3.2" names
        a team and a shift (docs/DECISIONS.md D17).
      */}
      <ScoreCard
        title="Food"
        caption="Across every dish rated"
        summary={summary.food}
        distribution={summary.distribution}
        emptyHint="No dish ratings yet."
      />
      <ScoreCard
        title="Service"
        caption="One rating per sitting"
        summary={summary.service}
        distribution={summary.service_distribution}
        emptyHint="No service ratings yet. Diners are asked after they have rated their food."
      />

      <DishTable
        title="Needs attention"
        description={`Lowest rated dishes, ${summary.min_reviews_for_ranking}+ ratings`}
        dishes={summary.needs_attention}
        tone="danger"
      />
      <DishTable
        title="Best rated"
        description={`Highest rated dishes, ${summary.min_reviews_for_ranking}+ ratings`}
        dishes={summary.top_rated}
        tone="neutral"
      />
    </div>
  )
}

/**
 * One headline score with the distribution behind it.
 *
 * The distribution sits beside the average rather than under it because the two answer different
 * questions and a manager needs both at once: a 3.0 built from straight 3s is a dull menu, and a
 * 3.0 built from 5s and 1s is an inconsistent kitchen. Those need opposite responses, and an
 * average alone cannot tell them apart. The same split holds for service, where the second shape
 * is a staffing problem rather than a training one.
 */
function ScoreCard({
  title,
  caption,
  summary,
  distribution,
  emptyHint,
}: {
  title: string
  caption: string
  summary: RatingSummary
  distribution: readonly number[]
  emptyHint: string
}) {
  if (summary.count === 0) {
    return (
      <Card>
        <CardHeader as="h3" title={title} description={caption} />
        <p className="mt-2 text-sm text-muted">{emptyHint}</p>
      </Card>
    )
  }

  // Scaled to the tallest bar, not to the total: with 40 fives and 2 ones the ones would be a
  // 1px sliver against the total and read as zero.
  const peak = Math.max(...distribution, 1)

  return (
    <Card className="flex items-center gap-4">
      <div className="shrink-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
        <p className="text-3xl font-semibold tabular-nums text-ink">
          {formatRating(summary.average)}
        </p>
        <p className="text-xs text-muted tabular-nums">
          {summary.count} {summary.count === 1 ? 'rating' : 'ratings'}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Highest star first: the chart reads top-down as best-to-worst, which is the order
            people expect and the order the numbers are usually quoted in. */}
        {[5, 4, 3, 2, 1].map((star) => {
          const count = distribution[star - 1] ?? 0
          return (
            <div key={star} className="flex items-center gap-1.5 text-xs">
              <span className="w-2 tabular-nums text-muted">{star}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    isLowRating(star) ? 'bg-danger' : 'bg-accent',
                  )}
                  style={{ width: `${(count / peak) * 100}%` }}
                />
              </span>
              <span className="w-6 text-right tabular-nums text-muted">{count}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** One end of the menu ranking. */
function DishTable({
  title,
  description,
  dishes,
  tone,
}: {
  title: string
  description: string
  dishes: RatedDishView[]
  tone: 'danger' | 'neutral'
}) {
  return (
    <Card>
      <CardHeader as="h3" title={title} description={description} />
      {dishes.length === 0 ? (
        // Says WHY it is empty. Without the threshold, a blank panel on a restaurant's first
        // week reads as broken rather than as "not enough data yet".
        <p className="mt-2 text-sm text-muted">Not enough ratings yet to rank any dish.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {dishes.map((dish) => (
            <li key={dish.menu_item_uid} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm text-ink">{dish.name}</span>
              <span className="flex shrink-0 items-baseline gap-1 text-sm tabular-nums">
                <span
                  className={cn(
                    'font-semibold',
                    tone === 'danger' && isLowRating(dish.rating.average)
                      ? 'text-danger'
                      : 'text-ink',
                  )}
                >
                  {formatRating(dish.rating.average)}
                </span>
                <span className="text-xs text-muted">({dish.rating.count})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Five stars, read-only and small.
 *
 * `role="img"` with a label rather than five decorative glyphs: the row is one piece of
 * information, and without a role a screen reader reads either nothing or five stars.
 */
function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={`${rating} out of 5`}
      className="flex shrink-0 items-center gap-px"
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5',
            value <= rating
              ? isLowRating(rating)
                ? 'fill-danger text-danger'
                : 'fill-accent text-accent'
              : 'text-faint',
          )}
          strokeWidth={1.5}
        />
      ))}
    </span>
  )
}

/** How many ratings on this restaurant are complaints, from the distribution already loaded. */
function lowRatingCount(summary: ReviewSummaryResponse, dataset: Dataset): number {
  // Indices 0..2 are 1..3 stars, matching isLowRating's threshold. Derived from the summary
  // rather than counted from the page, which only holds one page's worth -- and read from
  // whichever distribution the list is currently showing, or the badge would count food
  // complaints while the reader is looking at service.
  const d = dataset === 'service' ? summary.service_distribution : summary.distribution
  return (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0)
}

function emptyTitle(filter: Filter, dataset: Dataset): string {
  switch (filter) {
    case 'low':
      return 'Nothing needs attention'
    case 'commented':
      return 'No written notes'
    default:
      return dataset === 'service' ? 'No service ratings yet' : 'No reviews yet'
  }
}

function emptyDescription(filter: Filter, dataset: Dataset): string {
  const subject = dataset === 'service' ? 'the service' : 'a dish'
  switch (filter) {
    case 'low':
      return `No diner has rated ${subject} three stars or below.`
    case 'commented':
      return 'Most diners rate with a tap and move on, which is by design — the stars and tags are the signal.'
    default:
      return dataset === 'service'
        ? 'Diners are asked about service after they have rated their food, so these arrive a little behind the dish ratings.'
        : 'A diner is asked to rate once their food has reached the table. Ratings appear here as they arrive.'
  }
}
