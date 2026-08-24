/**
 * Input handling for the onboarding form (docs/DECISIONS.md D14).
 *
 * Pure functions, in their own file, for the same reason `price-input.ts` is: each one turns
 * something an operator typed into something that becomes permanent, and each is testable
 * without a browser.
 */

/**
 * A live preview of the URL a restaurant is about to be given.
 *
 * **A preview only. The server is authoritative** and re-normalises whatever is sent, so a drift
 * between this and `utils.Slugify` in Go shows up as a slug that differs slightly from the
 * preview -- never as a broken restaurant.
 *
 * It is worth the duplication anyway: `/r/{slug}` goes onto printed signage and cannot be
 * changed without invalidating it, so an operator should see it before committing rather than
 * discover it in the response. The rules are deliberately the same three as the Go version:
 * lowercase, everything outside [a-z0-9] becomes a separator, runs collapse, ends trimmed.
 */
export function slugPreview(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * `bps: undefined` on success is the "field left blank" case, and it is not the same as `0`.
 * Modelled in the type so a caller cannot collapse the two by writing `result.bps ?? 0`.
 */
export type PercentParseResult =
  | { ok: true; bps: number | undefined }
  | { ok: false; error: string }

/**
 * Percent in the UI, basis points on the wire: 5 -> 500.
 *
 * The API stores rates as integer basis points so every money computation stays in integer
 * arithmetic (docs/DECISIONS.md D7), and an operator thinks in percent.
 *
 * An empty string returns `ok` with no `bps`, which the caller must treat as "omit the field" and
 * not as zero. That distinction is the whole reason this returns a result object: sending 0 for a
 * blank tax input would onboard a tax-free restaurant, while omitting the field inherits the 5%
 * GST default the schema already has.
 */
export function parsePercentToBps(raw: string): PercentParseResult {
  const value = raw.trim()
  if (value === '') return { ok: true, bps: undefined }

  if (!/^\d*(\.\d{1,2})?$/.test(value)) {
    return { ok: false, error: 'Use a percentage with at most two decimals, e.g. 5 or 18.5' }
  }

  const percent = Number.parseFloat(value)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: 'Must be between 0 and 100' }
  }

  // Rounded because 7.35% is exactly 735 bps but floating-point multiplication can land on
  // 734.9999999. This is the only place a float touches a rate, and it is made integral again
  // immediately.
  return { ok: true, bps: Math.round(percent * 100) }
}

export type TableRangeResult = { ok: true; count: number } | { ok: false; error: string }

/**
 * Validates a table range before it is sent, so an obvious mistake is caught next to the input
 * rather than as a 422 after the form is submitted.
 *
 * The server checks the same bounds, and that is the check that counts -- this one exists to put
 * the message beside the field.
 */
export function checkTableRange(from: number, to: number, max = 200): TableRangeResult {
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { ok: false, error: 'Use whole numbers' }
  }
  if (from < 1) return { ok: false, error: 'Table numbers start at 1' }
  if (to < from) return { ok: false, error: "'to' cannot be lower than 'from'" }

  const count = to - from + 1
  if (count > max) {
    return { ok: false, error: `That is ${count} tables; at most ${max} can be created at once` }
  }
  return { ok: true, count }
}
