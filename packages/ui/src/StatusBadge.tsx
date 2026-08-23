import {
  DINER_STATUS_LABEL,
  type OrderStatus,
  STAFF_STATUS_LABEL,
  STATUS_TONE,
  type StatusTone,
} from '@tablex/shared'
import { cn } from './cn'

/**
 * The tone-to-colour mapping, and the only judgement this component makes.
 *
 * Each pair reads through a CSS variable with a neutral fallback, so an app themes the five
 * tones from its own stylesheet -- the diner app and the admin panel are deliberately
 * unalike (docs/DECISIONS.md D11) and neither should have to fork the pill to look like
 * itself.
 */
const TONE_CLASS: Record<StatusTone, string> = {
  new: 'bg-[var(--tx-tone-new-bg,#e8f0ff)] text-[var(--tx-tone-new-fg,#1b3f7a)]',
  progress: 'bg-[var(--tx-tone-progress-bg,#fff4e0)] text-[var(--tx-tone-progress-fg,#8a4b00)]',
  ready: 'bg-[var(--tx-tone-ready-bg,#e3f7ea)] text-[var(--tx-tone-ready-fg,#0f6b34)]',
  done: 'bg-[var(--tx-tone-done-bg,#eef0f3)] text-[var(--tx-tone-done-fg,#3f4854)]',
  failed: 'bg-[var(--tx-tone-failed-bg,#fdeaea)] text-[var(--tx-tone-failed-fg,#93211f)]',
}

export interface StatusBadgeProps {
  status: OrderStatus
  audience: 'diner' | 'staff'
  className?: string
}

/**
 * An order status pill.
 *
 * Both label sets live in @tablex/shared because the same state reads differently to the two
 * audiences -- `placed` is "Order received" to a diner and "New" to the kitchen -- and
 * `audience` is required rather than defaulted so neither app can quietly show the other's
 * copy.
 *
 * It renders a status and never a transition: which moves are legal arrives on
 * `order.next_statuses` from the server (docs/DECISIONS.md D1), so there is nothing here to
 * drift out of step with the state machine.
 *
 * `data-status` and `data-tone` are on every pill so an app can restyle a tone by selector
 * and tests can assert on the machine value instead of on copy that will be translated
 * (PRD 7).
 */
export function StatusBadge({ status, audience, className }: StatusBadgeProps) {
  const tone = STATUS_TONE[status]
  const label = audience === 'diner' ? DINER_STATUS_LABEL[status] : STAFF_STATUS_LABEL[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
      data-status={status}
      data-tone={tone}
      data-audience={audience}
    >
      {label}
    </span>
  )
}
