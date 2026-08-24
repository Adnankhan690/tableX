import { describe, expect, it } from 'bun:test'
import { checkTableRange, parsePercentToBps, slugPreview } from './onboard-input'

/**
 * These three decide what an operator permanently assigns to a restaurant, so they are tested by
 * rule rather than by example. The slug in particular ends up on printed signage.
 */

describe('slugPreview', () => {
  it('matches what utils.Slugify produces in Go', () => {
    // The same cases as the Go test, deliberately. This is a preview of a value the server
    // computes, so the two agreeing is the only thing that makes showing it honest.
    const cases: Array<[string, string]> = [
      ['Spice Garden', 'spice-garden'],
      ['  Coastal Curry  ', 'coastal-curry'],
      ['Tandoor Junction!', 'tandoor-junction'],
      ['Cafe 24/7', 'cafe-24-7'],
      ['THE BIG PLATE', 'the-big-plate'],
      ['Spice   &&&   Garden', 'spice-garden'],
      ['...Dhaba...', 'dhaba'],
      ['spice_garden', 'spice-garden'],
    ]
    for (const [input, expected] of cases) {
      expect(slugPreview(input)).toBe(expected)
    }
  })

  it('returns empty for a name with nothing usable in it, rather than a row of dashes', () => {
    // The form shows a placeholder for this and the server refuses it. Returning '---' would
    // preview a URL that can never exist.
    for (const input of ['!!!', '   ', '***', '###']) {
      expect(slugPreview(input)).toBe('')
    }
  })
})

describe('parsePercentToBps', () => {
  it('converts percent to integer basis points', () => {
    const cases: Array<[string, number]> = [
      ['0', 0],
      ['5', 500],
      ['5.0', 500],
      ['18', 1800],
      ['18.5', 1850],
      ['7.35', 735],
      ['100', 10000],
      ['  5  ', 500],
    ]
    for (const [input, expected] of cases) {
      const result = parsePercentToBps(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.bps).toBe(expected)
    }
  })

  it('distinguishes blank from zero', () => {
    // The bug this exists to prevent: sending 0 for an untouched tax field would onboard a
    // tax-free restaurant, where omitting the field inherits the schema's 5% GST default.
    const blank = parsePercentToBps('   ')
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.bps).toBeUndefined()

    const zero = parsePercentToBps('0')
    expect(zero.ok).toBe(true)
    if (zero.ok) expect(zero.bps).toBe(0)
  })

  it('rejects out-of-range and malformed input rather than clamping', () => {
    // A clamped 500% would become 100% tax silently, which is the kind of number nobody
    // re-reads after saving.
    for (const input of ['101', '500', '-5', 'five', '5.555', '5..5', '5%', '1e2']) {
      expect(parsePercentToBps(input).ok).toBe(false)
    }
  })
})

describe('checkTableRange', () => {
  it('counts inclusively at both ends', () => {
    const one = checkTableRange(7, 7)
    expect(one.ok).toBe(true)
    if (one.ok) expect(one.count).toBe(1)

    const ten = checkTableRange(1, 10)
    expect(ten.ok).toBe(true)
    if (ten.ok) expect(ten.count).toBe(10)
  })

  it('refuses an inverted range, a zero start, and a range over the cap', () => {
    expect(checkTableRange(10, 2).ok).toBe(false)
    expect(checkTableRange(0, 5).ok).toBe(false)
    expect(checkTableRange(1, 201).ok).toBe(false)
    // The cap itself is fine -- off by one here would refuse a legitimate 200-table floor.
    expect(checkTableRange(1, 200).ok).toBe(true)
  })

  it('refuses NaN, which is what an empty numeric input parses to', () => {
    // parseInt('') is NaN, and every comparison against NaN is false -- so without an explicit
    // check an empty field would sail through as a valid range and fail server-side instead.
    expect(checkTableRange(Number.NaN, 10).ok).toBe(false)
    expect(checkTableRange(1, Number.NaN).ok).toBe(false)
  })
})
