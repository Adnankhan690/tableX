'use client'

import { isApiError } from '@tablex/api-client'
import type {
  OrderItemReviewView,
  OrderItemView,
  OrderView,
  ReviewTag,
  ServiceReviewView,
  ServiceTag,
} from '@tablex/shared'
import {
  RATING_LABEL,
  RATING_VALUES,
  REVIEW_TAG_LABEL,
  reviewTagsForRating,
  SERVICE_RATING_LABEL,
  SERVICE_TAG_LABEL,
  serviceTagsForRating,
} from '@tablex/shared'
import { cn, FoodTypeBadge } from '@tablex/ui'
import { useCallback, useMemo, useState } from 'react'
import { useGatedSession } from '@/components/session-gate'
import { api } from '@/lib/api'

/**
 * The rating card (PRD 6.5).
 *
 * THE ONE CONSTRAINT THIS IS BUILT AROUND: a diner gives a complete review in a single tap.
 *
 * There is no Submit button anywhere in this component, and that is not a shortcut -- it is
 * the feature. Tapping a star fires the request immediately and optimistically, so a diner
 * who rates two dishes and pockets their phone has given us everything we asked for. Every
 * additional field is optional, collapsed by default, and saves the same way. A form with a
 * Submit button collects a fraction of this, because the tap that abandons it is the last one.
 *
 * Placed inline on the tracking screen rather than in a modal or on its own route: the diner
 * is already on this screen watching their order, so the card costs them no navigation and
 * interrupts nothing. A sheet that springs up over a diner mid-meal is a higher capture rate
 * bought with an interruption, and one they may be in the middle of paying through.
 */
export function RateOrder({
  order,
  onWindowClosed,
}: {
  order: OrderView
  onWindowClosed: () => void
}) {
  // Only lines that actually reached the table. A line the kitchen cancelled individually was
  // never received, so a rating on it would describe nothing (PRD 9.1) -- and the server
  // refuses it anyway.
  const items = useMemo(
    () => order.items.filter((item) => item.status !== 'cancelled'),
    [order.items],
  )

  if (items.length === 0) return null

  return (
    <section className="rounded-card border border-line bg-surface">
      {/*
        The heading, and nothing else.

        There was a line here reading "Tap a star. That is the whole thing -- it saves as you
        go." It was removed rather than reworded, because every part of it was already being
        said by something better:

          * "Tap a star" explains a five-star row, which is among the most universally
            understood controls there is. Instructions for a control nobody needs instructions
            for read as doubt about the control.
          * "it saves as you go" is a promise the "Saved" tick keeps one tap later. Making it
            in advance asks the diner to take on trust what the interface is about to
            demonstrate.
          * "That is the whole thing" is the copy insisting. Text that argues an interface is
            simple is a reliable sign it is not -- and here it is, so the argument is unearned.

        It also cost two lines above the fold on a phone, pushing the actual stars down.
      */}
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">How was it?</h2>
      </div>

      <ul>
        {items.map((item) => (
          <RateItemRow
            key={item.uid}
            orderUid={order.uid}
            item={item}
            onWindowClosed={onWindowClosed}
          />
        ))}
      </ul>

      {/*
        The service row, LAST and never first.

        Placement is the whole design here. Above the dishes it would cannibalise them: a general
        question is easier to answer than five specific ones, so some diners would answer it and
        stop -- and the per-dish ratings are the half a kitchen can act on. After them it is purely
        additive, one more tap from someone already engaged.

        It is also the only outlet a diner has for a floor complaint. Without it "the food took an
        hour" gets expressed as two stars on the biryani, which blames a dish for a problem the
        kitchen did not cause (docs/DECISIONS.md D17).
      */}
      <ServiceRow
        orderUid={order.uid}
        existing={order.service_review ?? null}
        onWindowClosed={onWindowClosed}
      />
    </section>
  )
}

/** What one line's rating is doing right now, so the row can show it without a spinner. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * One dish, one row.
 *
 * State is local to the row rather than lifted: each row saves independently, and a shared
 * reducer would make one slow request block the feedback on another dish the diner has
 * already tapped.
 */
function RateItemRow({
  orderUid,
  item,
  onWindowClosed,
}: {
  orderUid: string
  item: OrderItemView
  onWindowClosed: () => void
}) {
  const session = useGatedSession()

  const [review, setReview] = useState<OrderItemReviewView | null>(item.review ?? null)
  const [state, setState] = useState<SaveState>(item.review ? 'saved' : 'idle')
  const [error, setError] = useState<string | null>(null)
  // Governs the free-text note ONLY, and never opens by itself.
  //
  // The tag chips appear as soon as a star is tapped, because each one is another single tap
  // and costs the diner nothing to ignore. A textarea is different in kind: an open text box
  // is what turns a one-tap interaction back into a form, and two of them stacked down a card
  // is the exact thing this feature exists to avoid. So prose stays behind a link, always
  // opened deliberately.
  const [noteOpen, setNoteOpen] = useState(Boolean(item.review?.comment))
  const [comment, setComment] = useState(item.review?.comment ?? '')

  const rating = review?.rating ?? 0
  const tags = review?.tags ?? []

  const save = useCallback(
    (nextRating: number, nextTags: ReviewTag[], nextComment: string) => {
      if (!session) return

      // Optimistic. On a restaurant's 3G the request can take a second, and a star that does
      // not fill until it returns reads as a tap that did not register -- so the diner taps
      // again, and the only thing worse than no feedback is feedback that looks broken.
      const optimistic: OrderItemReviewView = {
        uid: review?.uid ?? '',
        rating: nextRating,
        tags: nextTags,
        comment: nextComment,
        updated_at: new Date().toISOString(),
      }
      const previous = review
      setReview(optimistic)
      setState('saving')
      setError(null)

      api
        .rateOrderItem(session.token, orderUid, item.uid, {
          rating: nextRating,
          ...(nextTags.length > 0 ? { tags: nextTags } : {}),
          ...(nextComment !== '' ? { comment: nextComment } : {}),
        })
        .then((saved) => {
          setReview(saved)
          setState('saved')
        })
        .catch((err: unknown) => {
          setReview(previous)
          setState('error')

          // The window shut underneath them -- most often because this order is now a day old.
          // Not an error worth alarming anyone about: the parent refetches and the card
          // disappears on its own.
          if (isApiError(err) && err.code === 'TX_REV_001') {
            onWindowClosed()
            return
          }
          setError(isApiError(err) ? err.message : 'Could not save that. Tap again?')
        })
    },
    [item.uid, onWindowClosed, orderUid, review, session],
  )

  const rate = useCallback(
    (next: number) => {
      // Re-tapping the same star is a no-op rather than a request. It is a common accident on a
      // 44px target and there is nothing to change.
      if (next === rating) return

      // Tags are polarity-matched to the rating, so a diner who drops five stars to two must
      // not keep "Tasty" attached. Dropped rather than migrated: there is no honest mapping.
      const kept = tags.filter((tag) => reviewTagsForRating(next).includes(tag))
      save(next, kept, comment)
    },
    [comment, rating, save, tags],
  )

  const toggleTag = useCallback(
    (tag: ReviewTag) => {
      const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
      save(rating, next, comment)
    },
    [comment, rating, save, tags],
  )

  // The note saves when the diner stops typing rather than on a button, keeping the
  // no-Submit rule intact for the one field where they are actually typing.
  const commitComment = useCallback(() => {
    const trimmed = comment.trim()
    if (rating === 0 || trimmed === (review?.comment ?? '')) return
    save(rating, tags, trimmed)
  }, [comment, rating, review?.comment, save, tags])

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <FoodTypeBadge type={item.food_type} size={13} />
        <span className="min-w-0 flex-1 text-[0.9375rem] leading-snug">
          {item.quantity > 1 ? `${item.quantity} × ` : ''}
          {item.name}
        </span>
        <SaveIndicator state={state} />
      </div>

      <StarRow label={item.name} rating={rating} labels={RATING_LABEL} onRate={rate} />

      {error !== null ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-nonveg">
          {error}
        </p>
      ) : null}

      {rating > 0 ? (
        <OptionalDetail
          offered={reviewTagsForRating(rating)}
          tagLabel={REVIEW_TAG_LABEL}
          tags={tags}
          comment={comment}
          noteOpen={noteOpen}
          onOpenNote={() => setNoteOpen(true)}
          onToggleTag={toggleTag}
          onCommentChange={setComment}
          onCommentCommit={commitComment}
        />
      ) : null}
    </li>
  )
}

/**
 * "And the service?"
 *
 * Session-scoped, not order-scoped: `existing` arrives on every order this session placed, and
 * saving from any of them writes the one row (docs/DECISIONS.md D17). A diner with two orders open
 * therefore sees the same answer on both, which is the correct behaviour rather than a bug to
 * paper over -- they were served once.
 *
 * State is local for the same reason each dish row holds its own: one slow request must not freeze
 * the feedback on anything else the diner has already tapped.
 */
function ServiceRow({
  orderUid,
  existing,
  onWindowClosed,
}: {
  orderUid: string
  existing: ServiceReviewView | null
  onWindowClosed: () => void
}) {
  const session = useGatedSession()

  const [review, setReview] = useState<ServiceReviewView | null>(existing)
  const [state, setState] = useState<SaveState>(existing ? 'saved' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(Boolean(existing?.comment))
  const [comment, setComment] = useState(existing?.comment ?? '')

  const rating = review?.rating ?? 0
  const tags = useMemo(() => review?.tags ?? [], [review?.tags])

  const save = useCallback(
    (nextRating: number, nextTags: ServiceTag[], nextComment: string) => {
      const optimistic: ServiceReviewView = {
        uid: review?.uid ?? '',
        rating: nextRating,
        tags: nextTags,
        comment: nextComment,
        updated_at: new Date().toISOString(),
      }
      const previous = review
      setReview(optimistic)
      setState('saving')
      setError(null)

      api
        .rateService(session.token, orderUid, {
          rating: nextRating,
          ...(nextTags.length > 0 ? { tags: nextTags } : {}),
          ...(nextComment !== '' ? { comment: nextComment } : {}),
        })
        .then((saved) => {
          setReview(saved)
          setState('saved')
        })
        .catch((err: unknown) => {
          setReview(previous)
          setState('error')

          if (isApiError(err) && err.code === 'TX_REV_001') {
            onWindowClosed()
            return
          }
          setError(isApiError(err) ? err.message : 'Could not save that. Tap again?')
        })
    },
    [onWindowClosed, orderUid, review, session.token],
  )

  const rate = useCallback(
    (next: number) => {
      if (next === rating) return
      // Same polarity rule as the dish rows: a diner dropping five stars to two must not keep
      // "Friendly staff" attached, and there is no honest way to migrate it.
      const kept = tags.filter((tag) => serviceTagsForRating(next).includes(tag))
      save(next, kept, comment)
    },
    [comment, rating, save, tags],
  )

  const toggleTag = useCallback(
    (tag: ServiceTag) => {
      const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
      save(rating, next, comment)
    },
    [comment, rating, save, tags],
  )

  const commitComment = useCallback(() => {
    const trimmed = comment.trim()
    if (rating === 0 || trimmed === (review?.comment ?? '')) return
    save(rating, tags, trimmed)
  }, [comment, rating, review?.comment, save, tags])

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
          And the service?
        </span>
        <SaveIndicator state={state} />
      </div>

      <StarRow label="the service" rating={rating} labels={SERVICE_RATING_LABEL} onRate={rate} />

      {error !== null ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-nonveg">
          {error}
        </p>
      ) : null}

      {rating > 0 ? (
        <OptionalDetail
          offered={serviceTagsForRating(rating)}
          tagLabel={SERVICE_TAG_LABEL}
          tags={tags}
          comment={comment}
          noteOpen={noteOpen}
          onOpenNote={() => setNoteOpen(true)}
          onToggleTag={toggleTag}
          onCommentChange={setComment}
          onCommentCommit={commitComment}
        />
      ) : null}
    </div>
  )
}

/**
 * The five stars.
 *
 * A radiogroup rather than five unrelated buttons, so a screen reader announces it as one
 * control with a current value instead of five things to press. The label on each option is
 * the word, not the number -- "Good" tells someone what they are choosing where "4" does not.
 */
function StarRow({
  label,
  rating,
  labels,
  onRate,
}: {
  /** What is being rated, for the group's accessible name: "Rate Paneer Tikka". */
  label: string
  rating: number
  /**
   * The word for each star. Passed in rather than imported, because food and service do not say
   * the same thing at the top of the scale -- "Loved it" is something you say about a dish.
   */
  labels: Record<number, string>
  onRate: (next: number) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Rate ${label}`}
      // Pulled left so the stars line up with the dish name above rather than sitting inside
      // the badge's gutter, and given the full tap height even though the glyph is smaller.
      className="mt-1 flex items-center gap-0.5"
    >
      {RATING_VALUES.map((value) => {
        const filled = value <= rating
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`${value} — ${labels[value]}`}
            onClick={() => onRate(value)}
            className={cn(
              // 44px tall, so the target meets the floor even though the star itself is 26px.
              'flex min-h-tap min-w-[2.25rem] items-center justify-center',
              'transition-transform active:scale-90',
            )}
          >
            <Star filled={filled} />
          </button>
        )
      })}

      {rating > 0 ? (
        <span aria-live="polite" className="ml-1.5 text-[0.8125rem] font-medium text-muted">
          {labels[rating]}
        </span>
      ) : null}
    </div>
  )
}

/**
 * One star.
 *
 * Inline SVG because this app ships no icon library, by design (PRD 7 makes payload a product
 * requirement, and the enforcement is omission).
 *
 * An outline at rest rather than a grey fill: a row of five grey solid stars reads as a score
 * of zero already given, where five outlines read as an invitation.
 */
function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinejoin="round"
      aria-hidden="true"
      className={filled ? 'text-accent' : 'text-line'}
    >
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
    </svg>
  )
}

/** The quiet "saved" tick. No spinner: a spinner on a one-tap action is more noise than signal. */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saved') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[0.75rem] font-medium text-veg">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Saved
      </span>
    )
  }
  if (state === 'saving') {
    return <span className="shrink-0 text-[0.75rem] text-muted">Saving…</span>
  }
  return null
}

/**
 * The optional half: reasons and a note.
 *
 * Chips before free text, and the chips are the point. Typing on a phone in a restaurant is
 * the step people abandon, and a tag is countable in a way prose is not -- "9 people said cold
 * this week" is a service problem with an address, where nine sentences are an afternoon of
 * reading. The note is the escape hatch for the diner who wants one, not the ask.
 */
function OptionalDetail<T extends string>({
  offered,
  tagLabel,
  tags,
  comment,
  noteOpen,
  onOpenNote,
  onToggleTag,
  onCommentChange,
  onCommentCommit,
}: {
  /**
   * The tags worth offering at the current rating. Resolved by the caller rather than here,
   * because food and service draw on two different closed vocabularies and this component has no
   * business knowing which one it is rendering.
   */
  offered: readonly T[]
  tagLabel: Record<T, string>
  tags: T[]
  comment: string
  noteOpen: boolean
  onOpenNote: () => void
  onToggleTag: (tag: T) => void
  onCommentChange: (next: string) => void
  onCommentCommit: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {offered.map((tag) => {
          const on = tags.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleTag(tag)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[0.8125rem] transition-opacity active:opacity-70',
                on
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-line bg-surface text-muted',
              )}
            >
              {tagLabel[tag]}
            </button>
          )
        })}
      </div>

      {noteOpen ? (
        <textarea
          value={comment}
          onChange={(event) => onCommentChange(event.target.value)}
          // Saved on blur rather than behind a button, so the no-Submit rule holds even here.
          onBlur={onCommentCommit}
          maxLength={280}
          rows={2}
          // Deliberately not autofocused: on a phone that throws up the keyboard and covers the
          // rest of the card, and the repo's a11y lint forbids it. The box lands directly under
          // the link that was just tapped, so it is a short reach.
          placeholder="Anything else?"
          aria-label="Add an optional note"
          className={cn(
            'w-full resize-none rounded-card border border-line bg-surface-sunken px-3 py-2',
            'text-[0.875rem] leading-snug placeholder:text-muted',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={onOpenNote}
          className="text-[0.8125rem] font-medium text-accent underline"
        >
          Add a note
        </button>
      )}
    </div>
  )
}
