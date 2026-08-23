import type { Money as MoneyValue } from '@tablex/shared'
import { cn } from './cn'

export interface MoneyProps {
  money: MoneyValue
  className?: string
}

/**
 * Renders a server-supplied amount.
 *
 * It prints `display` and does no arithmetic at all -- no rounding, no summing, no
 * re-formatting (docs/DECISIONS.md D7). The server sends the string it has already grouped
 * in the Indian lakh/crore convention, and rendering exactly that is what guarantees the
 * diner's screen and the kitchen's screen show the same number to the paisa. Client-side
 * totals exist for one case only, the cart preview before submission, and that belongs in
 * `computeTotals` at the call site rather than in the component that displays money.
 *
 * `data-minor` exposes the authoritative integer paise so a test can assert on the value
 * without coupling itself to the formatting.
 */
export function Money({ money, className }: MoneyProps) {
  return (
    // Tabular figures because amounts are read down a column -- a bill or an order list
    // where the digits shift width per row is measurably harder to scan.
    <span
      className={cn('tabular-nums', className)}
      data-minor={money.minor}
      data-currency={money.currency}
    >
      {money.display}
    </span>
  )
}
