/**
 * Parsing a typed rupee amount into integer paise.
 *
 * A manager types "249.50"; the API takes 24950. This is the only place in the admin app where
 * a decimal string becomes money, and it is a pure function so it can be tested without a
 * browser.
 *
 * It deliberately mirrors `utils.ParseMajorToMinor` in the Go backend, including the strictness:
 * more than two decimal places is an ERROR, not something to round. A mistyped "249.555" must be
 * a visible failure rather than a silently altered price -- the manager would never find out,
 * and every diner would be charged the wrong amount until someone noticed.
 */

export type PriceParseResult = { ok: true; minor: number } | { ok: false; error: string }

export function parsePriceToMinor(raw: string): PriceParseResult {
  // Grouping separators are stripped: a manager pasting "1,299.00" from a spreadsheet is not
  // making a mistake.
  const value = raw.trim().replace(/,/g, '')

  if (value === '') return { ok: false, error: 'Enter a price' }

  // A leading + or - is rejected rather than handled. A negative menu price is always a typo,
  // and accepting one would let a dish credit the diner.
  if (!/^\d*(\.\d*)?$/.test(value)) {
    return { ok: false, error: 'Use digits and at most one decimal point' }
  }

  const [wholeRaw, fracRaw] = value.split('.')
  const whole = wholeRaw === '' ? '0' : (wholeRaw ?? '0')
  const frac = fracRaw ?? ''

  if (frac.length > 2) {
    return { ok: false, error: 'At most two decimal places (paise)' }
  }

  const major = Number.parseInt(whole, 10)
  if (!Number.isFinite(major)) return { ok: false, error: 'Enter a valid price' }

  // Bounded well above any real dish. The column is BIGINT, but an accidental extra digit is
  // far more likely than a ten-lakh thali.
  if (major > 1_000_000) return { ok: false, error: 'That price looks too large' }

  const minor = Number.parseInt(`${frac}00`.slice(0, 2), 10)

  return { ok: true, minor: major * 100 + minor }
}

/** Renders paise back into an editable field value: 24950 -> "249.50". */
export function formatMinorForInput(minor: number): string {
  const abs = Math.abs(Math.trunc(minor))
  return `${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`
}
