/**
 * Money helpers.
 *
 * The server sends both the integer paise and a pre-formatted display string, so the
 * client should normally render `money.display` and do no arithmetic at all
 * (docs/DECISIONS.md D7). These exist for the one case the server cannot cover: a cart
 * total recomputed locally as the diner taps + and -, before anything is sent.
 *
 * Every function here works in integer paise. No float ever touches an amount.
 */

/** Basis points divisor: 500 bps = 5.00%. */
export const BPS_DIVISOR = 10_000

/**
 * Applies a basis-point rate, rounding half-up.
 *
 * Rounding is explicit because truncation systematically undercharges by up to a paisa per
 * order, which is both wrong and a real number on a year's GST return. Matches
 * `utils.ApplyBasisPoints` in the Go backend exactly, so a locally computed cart total and
 * the server's authoritative total agree to the paisa.
 */
export function applyBasisPoints(amountMinor: number, bps: number): number {
  if (bps <= 0 || amountMinor === 0) return 0
  const product = amountMinor * bps
  return Math.floor((product + BPS_DIVISOR / 2) / BPS_DIVISOR)
}

/**
 * Formats paise for display with Indian digit grouping: 12345678 -> "₹1,23,456.78".
 *
 * Indian grouping is not the western thousands separator -- it groups the last three digits
 * then pairs. "12,345,678" reads as a typo to an Indian diner, and this is a diner-facing
 * product. Mirrors `utils.FormatINR` in the Go backend.
 */
export function formatINR(amountMinor: number): string {
  const negative = amountMinor < 0
  const abs = Math.abs(Math.trunc(amountMinor))

  const major = Math.floor(abs / 100).toString()
  const minor = (abs % 100).toString().padStart(2, '0')

  return `${negative ? '-' : ''}₹${groupIndian(major)}.${minor}`
}

/** Inserts separators using the lakh/crore convention. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits

  const tail = digits.slice(-3)
  let head = digits.slice(0, -3)

  const parts: string[] = []
  while (head.length > 2) {
    parts.unshift(head.slice(-2))
    head = head.slice(0, -2)
  }
  if (head) parts.unshift(head)

  return `${parts.join(',')},${tail}`
}

/** Formats paise without a currency symbol: 24950 -> "249.50". */
export function formatMinor(amountMinor: number): string {
  const negative = amountMinor < 0
  const abs = Math.abs(Math.trunc(amountMinor))
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`
}

/** A locally computed price breakdown, for the cart before checkout. */
export interface ComputedTotals {
  subtotalMinor: number
  taxMinor: number
  serviceChargeMinor: number
  totalMinor: number
}

/**
 * Recomputes a cart total client-side, for instant feedback as quantities change.
 *
 * This is a display convenience, never the authority: the server re-prices the whole order
 * from the live menu at placement, which is why `PlaceOrderRequest` carries no amount at
 * all. Kept arithmetically identical to the Go implementation so the number the diner sees
 * in the cart is the number on their bill.
 */
export function computeTotals(
  lines: ReadonlyArray<{ unitPriceMinor: number; quantity: number }>,
  taxBps: number,
  serviceChargeBps: number,
): ComputedTotals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0)
  const taxMinor = applyBasisPoints(subtotalMinor, taxBps)
  const serviceChargeMinor = applyBasisPoints(subtotalMinor, serviceChargeBps)

  return {
    subtotalMinor,
    taxMinor,
    serviceChargeMinor,
    totalMinor: subtotalMinor + taxMinor + serviceChargeMinor,
  }
}

/** Renders a basis-point rate as a percentage label: 500 -> "5%", 250 -> "2.5%". */
export function formatBps(bps: number): string {
  const percent = bps / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '')}%`
}
