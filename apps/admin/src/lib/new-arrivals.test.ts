import { describe, expect, it } from 'bun:test'
import {
  type ArrivalCandidate,
  arrivalPhrase,
  STALE_AFTER_SECONDS,
  scanForArrivals,
  stalePhrase,
} from './new-arrivals'

/** A fixed instant, so no test depends on the wall clock or has to sleep. */
const NOW = Date.parse('2026-03-14T19:30:00.000Z')

/** Placed `ago` seconds before NOW. Defaults to just now, which is never stale. */
const order = (
  uid: string,
  status: ArrivalCandidate['status'] = 'placed',
  table_label = '1',
  ago = 0,
): ArrivalCandidate => ({
  uid,
  status,
  table_label,
  placed_at: new Date(NOW - ago * 1000).toISOString(),
})

/**
 * Every test here is a false positive waiting to happen: a chime for an order that did not arrive.
 * Staff cannot audit that by looking -- they just learn to distrust the sound -- so the cases are
 * pinned rather than trusted.
 */
describe('scanForArrivals', () => {
  it('is silent on the first load and records what was already there', () => {
    const result = scanForArrivals(new Set(), [order('a'), order('b'), order('c')], false)
    expect(result.arrived).toHaveLength(0)
    expect([...result.unseen]).toEqual(['a', 'b', 'c'])
  })

  it('announces an unseen placed order', () => {
    const result = scanForArrivals(new Set(['a']), [order('a'), order('b')], true)
    expect(result.arrived.length).toBeGreaterThan(0)
    expect([...result.unseen]).toEqual(['b'])
  })

  it('stays silent for an unseen order that is already past placed', () => {
    // A colleague accepted it on another device before this board ever saw it.
    const seen = new Set(['a'])
    for (const status of ['accepted', 'preparing', 'ready', 'served'] as const) {
      const result = scanForArrivals(seen, [order('a'), order('b', status)], true)
      expect(result.arrived).toHaveLength(0)
      expect([...result.unseen]).toEqual(['b'])
    }
  })

  it('does not re-announce an order that is merely changing status', () => {
    const seen = new Set(['a'])
    // Same order, still placed, on a later refetch.
    expect(scanForArrivals(seen, [order('a')], true).arrived).toHaveLength(0)
    // And once it moves on.
    expect(scanForArrivals(seen, [order('a', 'preparing')], true).arrived).toHaveLength(0)
  })

  it('coalesces a batch of arrivals into one announcement', () => {
    // What a 5s poll during a rush actually looks like.
    const result = scanForArrivals(new Set(['a']), [order('a'), order('b'), order('c')], true)
    // Both come back in ONE scan, so the caller sounds one chime and speaks one line.
    expect(result.arrived.map((o) => o.uid)).toEqual(['b', 'c'])
    expect([...result.unseen]).toEqual(['b', 'c'])
  })

  it('announces a mixed batch when any one of them is placed', () => {
    const result = scanForArrivals(
      new Set(),
      [order('b', 'ready'), order('c', 'placed'), order('d', 'accepted')],
      true,
    )
    expect(result.arrived.length).toBeGreaterThan(0)
    expect([...result.unseen]).toEqual(['b', 'c', 'd'])
  })

  it('stays silent when a filtered-out order returns to the list', () => {
    /**
     * THE CASE THAT DRIVES THE GROW-ONLY SET.
     *
     * A staff member searches, the open set narrows to one order, then they clear the search and
     * everything comes back. Nothing arrived; the board must not announce eight orders.
     */
    const seen = new Set<string>()
    const first = scanForArrivals(seen, [order('a'), order('b'), order('c')], false)
    for (const uid of first.unseen) seen.add(uid)

    // Search narrows it. The set keeps 'b' and 'c' even though they left the list.
    const narrowed = scanForArrivals(seen, [order('a')], true)
    expect(narrowed.arrived).toHaveLength(0)
    for (const uid of narrowed.unseen) seen.add(uid)

    // Search cleared.
    const restored = scanForArrivals(seen, [order('a'), order('b'), order('c')], true)
    expect(restored.arrived).toHaveLength(0)
    expect([...restored.unseen]).toEqual([])
  })

  it('stays silent on an empty board', () => {
    expect(scanForArrivals(new Set(['a']), [], true).arrived).toHaveLength(0)
    expect(scanForArrivals(new Set(), [], false).arrived).toHaveLength(0)
  })
})

/**
 * These are read out loud, so a wrong plural or a missing separator is heard by everyone in the
 * kitchen while looking perfectly fine in the source. Pinned by example.
 */
describe('arrivalPhrase', () => {
  it('names the table for a single arrival', () => {
    expect(arrivalPhrase([order('a', 'placed', '7')])).toBe('New order on table 7')
  })

  it('pluralises the noun but not the table when two orders share one table', () => {
    expect(arrivalPhrase([order('a', 'placed', '7'), order('b', 'placed', '7')])).toBe(
      'New orders on table 7',
    )
  })

  it('joins two tables with "and" and no comma', () => {
    expect(arrivalPhrase([order('a', 'placed', '7'), order('b', 'placed', '2')])).toBe(
      'New orders on tables 7 and 2',
    )
  })

  it('joins three tables with commas and a final "and"', () => {
    const phrase = arrivalPhrase([
      order('a', 'placed', '7'),
      order('b', 'placed', '2'),
      order('c', 'placed', '9'),
    ])
    expect(phrase).toBe('New orders on tables 7, 2 and 9')
  })

  it('falls back to a count past three tables rather than a list nobody retains', () => {
    const phrase = arrivalPhrase([
      order('a', 'placed', '7'),
      order('b', 'placed', '2'),
      order('c', 'placed', '9'),
      order('d', 'placed', '4'),
    ])
    expect(phrase).toBe('4 new orders')
  })

  it('handles non-numeric table labels, which the floor is allowed to use', () => {
    expect(arrivalPhrase([order('a', 'placed', 'Patio 1')])).toBe('New order on table Patio 1')
  })

  it('is empty when nothing arrived, so the caller says nothing at all', () => {
    expect(arrivalPhrase([])).toBe('')
  })
})

/**
 * Staleness is the second half of the same problem arrivals solve.
 *
 * An order used to announce itself exactly once, at the moment it appeared -- which is when a
 * kitchen is least able to look -- and then went silent however long it sat. These cases pin the
 * re-alert, and every one of them is a false positive risk in the other direction: a chime that
 * repeats is worse than one that never fires, because staff mute it and then miss the real ones.
 */
describe('scanForArrivals staleness', () => {
  const old = STALE_AFTER_SECONDS + 60

  it('re-alerts an order that has sat unaccepted past the threshold', () => {
    const result = scanForArrivals(
      new Set(['a']),
      [order('a', 'placed', '7', old)],
      true,
      new Set(),
      NOW,
    )
    expect(result.stale.map((o) => o.uid)).toEqual(['a'])
  })

  it('stays quiet until the threshold is actually crossed', () => {
    const fresh = scanForArrivals(
      new Set(['a']),
      [order('a', 'placed', '7', STALE_AFTER_SECONDS - 1)],
      true,
      new Set(),
      NOW,
    )
    expect(fresh.stale).toHaveLength(0)
  })

  it('sounds once, not on every poll', () => {
    // The caller records what it has re-alerted. Without this the board would chime every five
    // seconds for as long as the order sat there, which is how staff learn to mute the board.
    const result = scanForArrivals(
      new Set(['a']),
      [order('a', 'placed', '7', old)],
      true,
      new Set(['a']),
      NOW,
    )
    expect(result.stale).toHaveLength(0)
  })

  it('does not double-sound an order that is arriving for the first time', () => {
    // Old AND unseen -- a board opened mid-shift. It is news exactly once, as an arrival.
    const result = scanForArrivals(
      new Set(),
      [order('a', 'placed', '7', old)],
      true,
      new Set(),
      NOW,
    )
    expect(result.arrived.map((o) => o.uid)).toEqual(['a'])
    expect(result.stale).toHaveLength(0)
  })

  it('goes stale on the scan after priming, so a forgotten order is not silenced by a page load', () => {
    // Priming records `seen` but never `reAlerted`. An order that was already forty minutes old
    // when this board loaded is exactly the one somebody needs to hear about.
    const primed = scanForArrivals(
      new Set(),
      [order('a', 'placed', '7', old)],
      false,
      new Set(),
      NOW,
    )
    expect(primed.stale).toHaveLength(0)

    const next = scanForArrivals(
      new Set(primed.unseen),
      [order('a', 'placed', '7', old)],
      true,
      new Set(),
      NOW,
    )
    expect(next.stale.map((o) => o.uid)).toEqual(['a'])
  })

  it('ignores anything a human has already acknowledged', () => {
    for (const status of ['accepted', 'preparing', 'ready', 'served'] as const) {
      const result = scanForArrivals(
        new Set(['a']),
        [order('a', status, '7', old)],
        true,
        new Set(),
        NOW,
      )
      expect(result.stale).toHaveLength(0)
    }
  })
})

describe('stalePhrase', () => {
  it('says nothing when nothing is waiting', () => {
    expect(stalePhrase([])).toBe('')
  })

  it('names one table', () => {
    expect(stalePhrase([{ table_label: '7' }])).toBe('Table 7 is still waiting')
  })

  it('agrees the verb with the number of tables', () => {
    expect(stalePhrase([{ table_label: '7' }, { table_label: '9' }])).toBe(
      'Table 7 and 9 are still waiting',
    )
  })

  it('collapses two orders on one table to a single table', () => {
    expect(stalePhrase([{ table_label: '7' }, { table_label: '7' }])).toBe(
      'Table 7 is still waiting',
    )
  })

  it('falls back to a count past the point a spoken list is useful', () => {
    const many = ['1', '2', '3', '4', '5'].map((table_label) => ({ table_label }))
    expect(stalePhrase(many)).toBe('5 tables are still waiting')
  })

  it('reads differently from an arrival, so the two are distinguishable across a kitchen', () => {
    expect(stalePhrase([{ table_label: '7' }])).not.toBe(arrivalPhrase([{ table_label: '7' }]))
  })
})
