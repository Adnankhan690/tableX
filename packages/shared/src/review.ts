import type { ReviewTag, ServiceTag } from './types'

/**
 * Presentation metadata for ratings (PRD 6.5).
 *
 * Labels and vocabulary only. Whether a diner MAY rate is decided by the server and arrives
 * on `OrderView.can_review` -- duplicating that rule here is exactly how a UI ends up showing
 * a card that 409s, and it is a more subtle rule than it looks (see review_window.go).
 */

/** The scale. Five points, because the interaction is one tap on a row that has to fit a phone. */
export const RATING_MIN = 1
export const RATING_MAX = 5

/** The five values, for rendering a row of stars without an off-by-one in every component. */
export const RATING_VALUES = [1, 2, 3, 4, 5] as const

/**
 * How many ratings a dish needs before the DINER menu shows its score.
 *
 * Mirrors `services.MinRatingsToPublish`. Duplicated here only so the client can EXPLAIN the
 * absence ("not enough ratings yet") -- the server still decides, by omitting the field.
 */
export const MIN_RATINGS_TO_PUBLISH = 3

/**
 * What each star means, said in words.
 *
 * Shown as the diner's finger moves across the row, because a bare five-star widget makes
 * people hesitate over whether 3 is "fine" or "bad" -- and a diner who hesitates is one who
 * closes the screen. Written from the plate's point of view, not the restaurant's.
 */
export const RATING_LABEL: Record<number, string> = {
  1: 'Bad',
  2: 'Not great',
  3: 'Fine',
  4: 'Good',
  5: 'Loved it',
}

/** Human labels for the tag vocabulary. */
export const REVIEW_TAG_LABEL: Record<ReviewTag, string> = {
  tasty: 'Tasty',
  fresh: 'Fresh',
  good_portion: 'Good portion',
  well_presented: 'Well presented',
  worth_the_wait: 'Worth the wait',
  bland: 'Bland',
  too_spicy: 'Too spicy',
  served_cold: 'Served cold',
  small_portion: 'Small portion',
  not_as_described: 'Not as described',
}

/** Offered at 4-5 stars. */
export const POSITIVE_REVIEW_TAGS: readonly ReviewTag[] = [
  'tasty',
  'fresh',
  'good_portion',
  'well_presented',
  'worth_the_wait',
] as const

/** Offered at 1-3 stars. */
export const NEGATIVE_REVIEW_TAGS: readonly ReviewTag[] = [
  'too_spicy',
  'bland',
  'served_cold',
  'small_portion',
  'not_as_described',
] as const

/**
 * The tags worth offering for a given rating.
 *
 * Polarity-matched deliberately: showing "Tasty" to someone who just tapped one star reads as
 * not listening, and showing "Too spicy" to someone who tapped five is noise they have to
 * read past. The boundary sits at 4 because 3 is the rating people give something they were
 * disappointed by but too polite to call bad.
 */
export function reviewTagsForRating(rating: number): readonly ReviewTag[] {
  return rating >= 4 ? POSITIVE_REVIEW_TAGS : NEGATIVE_REVIEW_TAGS
}

/**
 * Formats an average for display.
 *
 * The server already rounds to one decimal; this fixes the trailing zero so a column of
 * scores stays aligned -- "4.0" and "4.3", never "4" and "4.3".
 */
export function formatRating(average: number): string {
  return average.toFixed(1)
}

/**
 * Whether a rating counts as a complaint.
 *
 * One definition, used by the admin feed's default filter and by whatever highlights a row.
 * Three and below, matching the `max_rating=3` query the reviews screen exists to answer:
 * a 3 is not a compliment, and treating it as neutral is how a kitchen misses a dish sliding.
 */
export function isLowRating(rating: number): boolean {
  return rating <= 3
}

// --- Service ---
//
// Rated once per SITTING, not per order, and kept entirely separate from the dish vocabulary. A
// diner saying "slow" about the floor and a diner saying "bland" about a dish are addressing two
// different teams, and blending them gives a restaurant one number that points at neither.

/** Human labels for the service vocabulary. */
export const SERVICE_TAG_LABEL: Record<ServiceTag, string> = {
  quick_service: 'Quick service',
  friendly_staff: 'Friendly staff',
  attentive: 'Attentive',
  clean_table: 'Clean table',
  slow_service: 'Slow service',
  hard_to_find_staff: 'Hard to find staff',
  table_not_clean: 'Table not clean',
  order_wrong: 'Order was wrong',
  rushed: 'Felt rushed',
}

/** Offered at 4-5 stars. */
export const POSITIVE_SERVICE_TAGS: readonly ServiceTag[] = [
  'quick_service',
  'friendly_staff',
  'attentive',
  'clean_table',
] as const

/** Offered at 1-3 stars. */
export const NEGATIVE_SERVICE_TAGS: readonly ServiceTag[] = [
  'slow_service',
  'hard_to_find_staff',
  'table_not_clean',
  'order_wrong',
  'rushed',
] as const

/**
 * The service tags worth offering for a given rating.
 *
 * Same polarity boundary as the dish tags, and for the same reason: offering "Friendly staff" to
 * someone who just tapped one star reads as not listening.
 */
export function serviceTagsForRating(rating: number): readonly ServiceTag[] {
  return rating >= 4 ? POSITIVE_SERVICE_TAGS : NEGATIVE_SERVICE_TAGS
}

/**
 * What each star means for SERVICE, said in words.
 *
 * Separate wording from RATING_LABEL because the two are not the same sentence. "Loved it" is
 * something you say about a dish; about service the honest top of the scale is that nothing went
 * wrong and someone was looking after you.
 */
export const SERVICE_RATING_LABEL: Record<number, string> = {
  1: 'Bad',
  2: 'Not great',
  3: 'Fine',
  4: 'Good',
  5: 'Looked after us',
}
