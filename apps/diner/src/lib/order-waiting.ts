/**
 * How long a diner has been left without confirmation, and what to tell them about it.
 *
 * Pulled out of the tracking screen and made pure for the same reason new-arrivals.ts is on the
 * admin side: every hard case here is a threshold, and a threshold that is wrong by one stage is
 * invisible in a running app -- you would have to sit at a table for twenty minutes to see it.
 * Cheap to pin in a test, near-impossible to spot by hand.
 */

/**
 * When an unconfirmed order stops being normal, and when it becomes something the diner has to
 * solve themselves.
 *
 * Accepting is not cooking -- it is the one tap that means "we have this" -- so an order nobody has
 * acknowledged after eight minutes has been missed rather than deprioritised. Twenty is the point
 * where waiting longer cannot help and the fastest route to food is a person.
 */
export const UNCONFIRMED_NOTICE_SECONDS = 8 * 60
export const UNCONFIRMED_ESCALATE_SECONDS = 20 * 60

/**
 * What the screen should be saying.
 *
 *  - `none`      nothing yet; a kitchen is allowed a few minutes
 *  - `notice`    this is longer than usual, and cancelling is available
 *  - `escalated` waiting is no longer useful; go and speak to someone
 */
export type WaitStage = 'none' | 'notice' | 'escalated'

export function unconfirmedStage(waitedSeconds: number): WaitStage {
  if (waitedSeconds >= UNCONFIRMED_ESCALATE_SECONDS) return 'escalated'
  if (waitedSeconds >= UNCONFIRMED_NOTICE_SECONDS) return 'notice'
  return 'none'
}
