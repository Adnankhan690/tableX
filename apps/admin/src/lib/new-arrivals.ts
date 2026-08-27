import type { OrderStatus } from '@tablex/shared'

/**
 * The only two fields arrival detection needs. Narrower than OrderView on purpose: it keeps this
 * function testable from literals rather than from a twenty-field fixture.
 */
export interface ArrivalCandidate {
  uid: string
  status: OrderStatus
  table_label: string
}

export interface ArrivalScan {
  /** Order UIDs in this list that were not in `seen`. The caller records these. */
  unseen: readonly string[]
  /**
   * The newly-arrived orders that need acknowledging -- see the `placed` reasoning below.
   *
   * The orders themselves rather than a count, because the spoken announcement needs their table
   * labels. Empty means nothing to announce.
   */
  arrived: readonly ArrivalCandidate[]
}

/**
 * Decides whether a refetch of the open set contains news worth making a sound about.
 *
 * Pulled out of useNewOrderChime and made pure because every hard case here is a false positive --
 * a chime for something that did not arrive -- and false positives are exactly what staff cannot
 * verify by looking. They are cheap to prove in a test and near-impossible to spot in a running
 * kitchen, so they are proven in new-arrivals.test.ts.
 *
 * The three rules, each answering a case that would otherwise sound wrongly:
 *
 *  1. UNPRIMED IS SILENT. The first fetch of a shift is however many orders are already open, and
 *     none of them just arrived. It records and says nothing.
 *  2. `placed` ONLY. The chime means "something is waiting for a human to acknowledge it". An order
 *     that first appears already accepted -- a colleague took it on another device, or the board's
 *     filter widened -- is not news for this room.
 *  3. ONE BATCH, NOT A STREAM. A socket ping or a 5s poll can reveal three orders at once. They
 *     come back together so the caller sounds one chime and speaks one line -- three chimes is a
 *     noise, and three spoken sentences is six seconds of talking over a kitchen.
 *
 * `seen` must be grow-only in the caller. The board's open set narrows when someone types in the
 * search box, so an order can leave the list and come back; against a set that forgot it, clearing
 * a search would announce every order on the board at once.
 */
export function scanForArrivals(
  seen: ReadonlySet<string>,
  orders: readonly ArrivalCandidate[],
  primed: boolean,
): ArrivalScan {
  if (!primed) {
    return { unseen: orders.map((order) => order.uid), arrived: [] }
  }

  const unseen: string[] = []
  const arrived: ArrivalCandidate[] = []
  for (const order of orders) {
    if (seen.has(order.uid)) continue
    unseen.push(order.uid)
    if (order.status === 'placed') arrived.push(order)
  }
  return { unseen, arrived }
}

/**
 * How many tables get named before the announcement gives up and reports a count.
 *
 * Three is a judgement, not a constraint: a spoken list of six table numbers over kitchen noise is
 * worse than useless -- nobody retains item four, and the sentence runs long enough that the next
 * arrival interrupts it. Past this, the count is the honest signal and the board carries the
 * detail.
 */
const MAX_SPOKEN_TABLES = 3

/**
 * Builds the line that gets spoken and put in the live region.
 *
 * Kept pure and separate from the speech engine so the phrasing is pinned by tests -- every case
 * here is a plural agreement or a list separator, and getting one wrong is the kind of thing that
 * sounds broken out loud while looking fine in code.
 *
 * Plurality follows the ORDER count and the list follows the UNIQUE tables, which is what makes
 * two orders on one table read correctly as "New orders on table 7".
 */
export function arrivalPhrase(arrived: readonly Pick<ArrivalCandidate, 'table_label'>[]): string {
  if (arrived.length === 0) return ''

  const noun = arrived.length === 1 ? 'New order' : 'New orders'
  const tables = [...new Set(arrived.map((order) => order.table_label))]

  // Nothing useful to name. Better a bare count than "New order on table undefined".
  if (tables.length === 0) return `${arrived.length} ${arrived.length === 1 ? 'order' : 'orders'}`

  if (tables.length > MAX_SPOKEN_TABLES) return `${arrived.length} new orders`

  const label = tables.length === 1 ? 'table' : 'tables'
  // "7, 2 and 9" -- spoken, so an Oxford comma before "and" would be read as a pause that makes
  // the last table sound like a separate sentence.
  const list =
    tables.length === 1
      ? tables[0]
      : `${tables.slice(0, -1).join(', ')} and ${tables[tables.length - 1]}`

  return `${noun} on ${label} ${list}`
}
