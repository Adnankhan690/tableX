'use client'

import type { OrderView } from '@tablex/shared'
import { useEffect, useRef, useState } from 'react'
import * as announce from '@/lib/announce'
import * as chime from '@/lib/chime'
import { readChimeEnabled } from '@/lib/chime-preference'
import { arrivalPhrase, scanForArrivals, stalePhrase } from '@/lib/new-arrivals'

/**
 * How long after the chime the spoken line starts.
 *
 * The chime runs 450ms. Speaking over its tail buries the first syllable -- which is the word that
 * carries the meaning -- so the announcement waits for silence. This is the airport-PA shape: a
 * tone to turn heads, then the words, to a room that is now listening.
 */
const SPEAK_DELAY_MS = 520

export interface NewOrderChime {
  /**
   * NO TOGGLE HERE ANY MORE. The control is a row on Settings (components/sound-setting.tsx); this
   * hook only reads the preference and plays. The board reads it fresh on mount, which is enough
   * because changing it on Settings and returning to the board remounts this.
   */
  /**
   * The last arrival as a sentence, for the board's live region.
   *
   * Exists because the chime and the speech are both audio, and audio reaches nobody who cannot
   * hear it. A deaf staff member and a screen-reader user get the same words on the same event.
   */
  announcement: Announcement
}

export interface Announcement {
  /** The sentence. Empty before the first arrival. */
  text: string
  /**
   * Increments on every arrival.
   *
   * A live region only re-announces when its content CHANGES, so two arrivals on the same table
   * would produce the same string and be read once. The board keys off this, which makes React
   * replace the node and the screen reader treat it as new.
   */
  seq: number
}

/**
 * Sounds a chime when an order needs a human -- either because it just arrived, or because it has
 * been sitting unacknowledged for too long.
 *
 * The second case is why this hook is not just about arrivals. An order used to announce itself
 * exactly once, at the moment it appeared, which is when a kitchen is least able to look; after
 * that the only escalation was the card's colour, and a red that never changes stops being read.
 *
 * `orders` must be the FILTER-INDEPENDENT open set -- the board's `queue`, not its `orders`. If it
 * were the visible list, filtering to Ready would silence every new order precisely when the person
 * has their attention somewhere other than the placed queue.
 */
export function useNewOrderChime(orders: OrderView[] | null): NewOrderChime {
  /**
   * Muted by default, and read from storage after mount.
   *
   * Two separate reasons, both load-bearing:
   *  - Hydration: reading localStorage in the initial state makes the server markup and the first
   *    client render disagree (same note as stats-strip.tsx).
   *  - Consent: a page that makes noise on first load without being asked is a page people mute at
   *    the operating system and never hear again. Off is the honest default; the toggle is visible.
   */
  const [enabled, setEnabled] = useState(false)
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', seq: 0 })

  /**
   * Every order UID this board has laid eyes on.
   *
   * GROWS ONLY, and that is what makes it correct rather than a leak. The board's `queue` narrows
   * when a staff member types in the search box, so an order can leave the list and come back --
   * against a set that forgot it, clearing a search would chime for eight orders at once. Bounded
   * by orders-per-shift and reset by a reload, so a few hundred short strings at worst.
   */
  const seen = useRef<Set<string>>(new Set())
  /**
   * False until the first list has landed.
   *
   * The first fetch of a shift is twelve unseen orders, and none of them just arrived. Priming
   * records them silently; only what shows up after that is news.
   */
  const primed = useRef(false)
  /**
   * Orders already re-alerted for having gone unacknowledged.
   *
   * Separate from `seen`, and it has to be: `seen` records that the board has MET an order, while
   * this records that it has COMPLAINED about one. Sharing a set would make the arrival chime
   * suppress the staleness chime, which is the exact pairing that produced the original bug --
   * announce once, then silence for as long as it sits.
   */
  const reAlerted = useRef<Set<string>>(new Set())
  /** Pending spoken line, so unmounting the board silences it mid-sentence. */
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Read after mount, never in the initialiser: see the note on readChimeEnabled.
  useEffect(() => {
    setEnabled(readChimeEnabled())
  }, [])

  /**
   * Any gesture anywhere unlocks audio.
   *
   * Capture phase and `once`, on the window: it must not depend on the staff member happening to
   * click a particular control, and it must stop listening the moment it has what it needs. Signing
   * in usually covers this before the board even mounts, but a restored session lands here with no
   * gesture on record.
   */
  useEffect(() => {
    if (!enabled) return

    const onGesture = () => {
      // Safari gates speech on a gesture too, and unlike an AudioContext there is no state to
      // read -- the first utterance just does nothing. Spend the gesture on both.
      announce.unlock()
      void chime.unlock()
    }

    window.addEventListener('pointerdown', onGesture, { capture: true, once: true })
    window.addEventListener('keydown', onGesture, { capture: true, once: true })
    return () => {
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('keydown', onGesture, { capture: true })
    }
  }, [enabled])

  useEffect(() => {
    if (orders === null) return

    // The decision itself is a pure function in lib/new-arrivals.ts, where its false-positive
    // cases -- a search filter narrowing the board, a colleague accepting first -- are tested.
    const { unseen, arrived, stale } = scanForArrivals(
      seen.current,
      orders,
      primed.current,
      reAlerted.current,
    )

    // Recorded whether or not it sounds. Muting must not build a backlog that fires all at once
    // the moment sound is switched back on.
    for (const uid of unseen) seen.current.add(uid)
    for (const order of stale) reAlerted.current.add(order.uid)
    primed.current = true

    if (arrived.length === 0 && stale.length === 0) return

    /**
     * ARRIVALS WIN when both land on the same scan.
     *
     * Not a tie-break for its own sake: a new order still needs a human, while a stale one has
     * already failed to get one, so the actionable half is the arrival. The stale orders keep
     * their place in `reAlerted` either way, which is a deliberate trade -- they lose this round's
     * chime rather than queueing up to interrupt the next one. The board is still showing them.
     */
    const phrase = arrived.length > 0 ? arrivalPhrase(arrived) : stalePhrase(stale)

    /**
     * The live region updates even when sound is off, and that is deliberate: it is the only
     * arrival signal available to someone who cannot hear, so it must not sit behind an audio
     * preference.
     */
    setAnnouncement((previous) => ({ text: phrase, seq: previous.seq + 1 }))

    if (!enabled) return

    // The chime is the attention-getter; if the browser refused it the words still arrive, into a
    // room that was not listening. Half a signal beats none. Nothing on the board reports the
    // refusal any more -- the Settings row is where that shows, since that is where the control is.
    chime.play()

    // Cleared on unmount below, so a line cannot outlive the board that asked for it.
    if (speakTimer.current !== null) clearTimeout(speakTimer.current)
    speakTimer.current = setTimeout(() => announce.speak(phrase), SPEAK_DELAY_MS)
  }, [orders, enabled])

  useEffect(
    () => () => {
      if (speakTimer.current !== null) clearTimeout(speakTimer.current)
      announce.stop()
    },
    [],
  )

  /**
   * NOT INSIDE A setState UPDATER. It used to be, and next.config.ts sets `reactStrictMode: true`,
   * which double-invokes updaters in development precisely to surface impurity like this -- so the
   * unlock, the storage write and the preview timer all ran twice, producing two overlapping
   * chimes. An updater must be a pure function of the previous state; the side effects belong here.
   */
  return { announcement }
}
