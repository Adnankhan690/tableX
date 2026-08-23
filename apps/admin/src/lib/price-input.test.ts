import { describe, expect, it } from 'bun:test'
import { formatMinorForInput, parsePriceToMinor } from './price-input'

/**
 * Money parsing is the one place in this app where a typo becomes a wrong charge on every future
 * order, so it is tested exhaustively rather than by example.
 */
describe('parsePriceToMinor', () => {
  it('parses whole and decimal rupees exactly', () => {
    const cases: Array<[string, number]> = [
      ['0', 0],
      ['0.01', 1],
      ['0.1', 10],
      ['0.10', 10],
      ['1', 100],
      ['249.5', 24950],
      ['249.50', 24950],
      ['1299', 129900],
      ['1,299.00', 129900],
      ['  249.50  ', 24950],
      ['.5', 50],
    ]
    for (const [input, expected] of cases) {
      const result = parsePriceToMinor(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.minor).toBe(expected)
    }
  })

  it('rejects more than two decimal places rather than rounding', () => {
    // The whole point: silently turning 249.555 into 24956 would misprice a dish forever.
    const result = parsePriceToMinor('249.555')
    expect(result.ok).toBe(false)
  })

  it('rejects negatives, letters and multiple decimal points', () => {
    for (const bad of ['-5', '5-', 'abc', '1.2.3', '12a', '₹100', '1 000']) {
      expect(parsePriceToMinor(bad).ok).toBe(false)
    }
  })

  it('rejects an empty value', () => {
    expect(parsePriceToMinor('').ok).toBe(false)
    expect(parsePriceToMinor('   ').ok).toBe(false)
  })

  it('rejects an implausibly large amount', () => {
    expect(parsePriceToMinor('99999999').ok).toBe(false)
  })

  it('round-trips through formatMinorForInput', () => {
    for (const minor of [0, 1, 10, 99, 100, 24950, 129900]) {
      const result = parsePriceToMinor(formatMinorForInput(minor))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.minor).toBe(minor)
    }
  })
})
