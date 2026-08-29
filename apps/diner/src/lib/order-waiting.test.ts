import { describe, expect, it } from 'bun:test'
import {
  UNCONFIRMED_ESCALATE_SECONDS,
  UNCONFIRMED_NOTICE_SECONDS,
  unconfirmedStage,
} from './order-waiting'

/**
 * The failure these pin is not a crash -- it is a diner sitting at a table being told nothing, or
 * being alarmed too early. Neither shows up in a page that renders fine.
 */
describe('unconfirmedStage', () => {
  it('says nothing while waiting is still normal', () => {
    expect(unconfirmedStage(0)).toBe('none')
    expect(unconfirmedStage(60)).toBe('none')
  })

  it('stays quiet right up to the threshold', () => {
    // Strictly below, so a diner is never warned at 7:59 about an eight-minute rule.
    expect(unconfirmedStage(UNCONFIRMED_NOTICE_SECONDS - 1)).toBe('none')
  })

  it('speaks up exactly on the threshold', () => {
    expect(unconfirmedStage(UNCONFIRMED_NOTICE_SECONDS)).toBe('notice')
  })

  it('holds at notice for the whole middle band', () => {
    expect(unconfirmedStage(UNCONFIRMED_ESCALATE_SECONDS - 1)).toBe('notice')
  })

  it('escalates on the second threshold and stays there', () => {
    expect(unconfirmedStage(UNCONFIRMED_ESCALATE_SECONDS)).toBe('escalated')
    expect(unconfirmedStage(60 * 60 * 4)).toBe('escalated')
  })

  it('never skips the notice stage', () => {
    // A diner must not go from "everything is fine" straight to "go find a waiter". Walked
    // second by second because an ordering mistake between the two branches would produce
    // exactly that, and would look correct in isolation.
    let seenNotice = false
    for (let t = 0; t <= UNCONFIRMED_ESCALATE_SECONDS; t++) {
      const stage = unconfirmedStage(t)
      if (stage === 'notice') seenNotice = true
      if (stage === 'escalated') break
    }
    expect(seenNotice).toBe(true)
  })

  it('treats a clock that has gone backwards as no wait at all', () => {
    // elapsedSeconds already floors at 0, but this is the boundary a device with a wrong clock
    // lands on, and reporting "escalated" there would be the worst possible read.
    expect(unconfirmedStage(-500)).toBe('none')
  })
})
