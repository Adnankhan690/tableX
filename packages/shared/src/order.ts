import type { FoodType, OrderStatus, PaymentMethod, PaymentStatus } from './types'

/**
 * Presentation metadata for the order lifecycle (docs/DECISIONS.md D1).
 *
 * Only labels and styling live here. Which transitions are legal is decided by the server
 * and arrives on `OrderView.next_statuses` -- duplicating that logic in the client is
 * exactly how a UI ends up offering a button that 409s.
 */

/** The forward path a diner sees on the tracking screen, in order. */
export const DINER_PROGRESS_STEPS: readonly OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'served',
] as const

/** Statuses that mean the order is finished, one way or another. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'completed',
  'rejected',
  'cancelled',
] as const

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function isLive(status: OrderStatus): boolean {
  return !isTerminal(status)
}

/**
 * Diner-facing status labels.
 *
 * Written from the diner's point of view, not the kitchen's: "Order received" tells them
 * something happened, where "Placed" is a database state. `ready` says "at your table
 * shortly" because a diner cannot act on "Ready" -- they are already sitting down.
 */
export const DINER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Order received',
  accepted: 'Confirmed by the kitchen',
  preparing: 'Being prepared',
  ready: 'Ready — at your table shortly',
  served: 'Served',
  completed: 'Completed',
  rejected: 'Could not be accepted',
  cancelled: 'Cancelled',
}

/** Staff-facing labels: short, because they are read at a glance on a busy floor. */
export const STAFF_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  completed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

/** The verb for the button that moves an order INTO a status. */
export const TRANSITION_VERB: Record<OrderStatus, string> = {
  placed: 'Reopen',
  accepted: 'Accept',
  preparing: 'Start preparing',
  ready: 'Mark ready',
  served: 'Mark served',
  completed: 'Close order',
  rejected: 'Reject',
  cancelled: 'Cancel',
}

/**
 * Transitions that must collect a reason before being sent.
 *
 * Mirrors `TransitionRequiresReason` on the server, which enforces it. Duplicated here only
 * so the UI can prompt in the same interaction rather than submitting, being rejected, and
 * asking afterwards.
 */
export const TRANSITIONS_REQUIRING_REASON: readonly OrderStatus[] = [
  'rejected',
  'cancelled',
] as const

export function requiresReason(target: OrderStatus): boolean {
  return TRANSITIONS_REQUIRING_REASON.includes(target)
}

/** Semantic tone for a status badge. Mapped to actual colours by each app's theme. */
export type StatusTone = 'new' | 'progress' | 'ready' | 'done' | 'failed'

export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  placed: 'new',
  accepted: 'progress',
  preparing: 'progress',
  ready: 'ready',
  served: 'done',
  completed: 'done',
  rejected: 'failed',
  cancelled: 'failed',
}

/**
 * How far along the diner's progress bar should be, 0..1.
 *
 * A terminal failure returns 0 rather than a partial bar: showing a cancelled order as
 * "60% done" is worse than showing no progress at all.
 */
export function progressFraction(status: OrderStatus): number {
  if (status === 'rejected' || status === 'cancelled') return 0
  if (status === 'completed') return 1

  const index = DINER_PROGRESS_STEPS.indexOf(status)
  if (index < 0) return 0
  return (index + 1) / DINER_PROGRESS_STEPS.length
}

// --- Food type ---

/**
 * The veg/non-veg marker (PRD 6.2).
 *
 * `symbol` is the square-dot convention that Indian packaging and menus already use -- green
 * for vegetarian, brown/red for non-vegetarian -- because that is what diners scan for
 * without reading a word.
 */
export const FOOD_TYPE_LABEL: Record<FoodType, string> = {
  veg: 'Veg',
  non_veg: 'Non-veg',
  egg: 'Contains egg',
}

export const FOOD_TYPE_TONE: Record<FoodType, 'veg' | 'nonveg' | 'egg'> = {
  veg: 'veg',
  non_veg: 'nonveg',
  egg: 'egg',
}

// --- Payment ---

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  online_upi: 'Pay by UPI',
  counter: 'Pay at the counter',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
}

/**
 * Formats a duration in seconds the way a person would say it.
 *
 * Used for "placed 4 min ago" on the kitchen board, where the whole point is judging at a
 * glance whether an order has been sitting too long -- so minutes are the unit that matters
 * and sub-minute precision is noise.
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`

  return `${Math.floor(hours / 24)}d`
}

/** Seconds elapsed since an ISO timestamp, floored at zero against clock skew. */
export function elapsedSeconds(iso: string, now: number = Date.now()): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now - then) / 1000))
}
