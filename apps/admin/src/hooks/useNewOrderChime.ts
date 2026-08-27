'use client'

import type { OrderView } from '@tablex/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as announce from '@/lib/announce'
import * as chime from '@/lib/chime'
import { arrivalPhrase, scanForArrivals } from '@/lib/new-arrivals'

/**
 * How long after the chime the spoken line starts.
 *
 * The chime runs 450ms. Speaking over its tail buries the first syllable -- which is the word that
 * carries the meaning -- so the announcement waits for silence. This is the airport-PA shape: a
 * tone to turn heads, then the words, to a room that is now listening.
 */
const SPEAK_DELAY_MS = 520

/**
 * Per-device, like the stats strip's collapse state: which tablet wants sound is a property of
 * where it sits in the building, not of who signed in. The kitchen tablet wants it; the manager's
 * laptop in the back office does not.
 *
 * `.v1` suffix per the convention in lib/auth.ts -- a future shape change reads a new key and gets
 * the default rather than misparsing this one.
 */
const MUTE_KEY = 'tablex.admin.chime-muted.v1'

export interface NewOrderChime {
  /** Whether sound is switched on for this device. */
  enabled: boolean
  toggle: () => void
  /**
   * True when sound is on but the browser has not let us make any: no user gesture yet, or no Web
   * Audio at all. Surfaced so the board can say so -- see the autoplay note in lib/chime.ts.
   */
  blocked: boolean
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
 * Sounds a chime when an order the staff member has not seen arrives needing acknowledgement.
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
  const [blocked, setBlocked] = useState(false)
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
  /** Pending spoken line, so unmounting the board silences it mid-sentence. */
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(MUTE_KEY) === '0') setEnabled(true)
    } catch {
      /* Private mode or storage disabled. Off stands; this is a preference, not data. */
    }
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
      // Awaited, not polled on a timer: see the note on chime.unlock.
      void chime.unlock().then((ready) => setBlocked(!ready))
    }

    setBlocked(chime.state() !== 'ready')
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
    const { unseen, arrived } = scanForArrivals(seen.current, orders, primed.current)

    // Recorded whether or not it sounds. Muting must not build a backlog that fires all at once
    // the moment sound is switched back on.
    for (const uid of unseen) seen.current.add(uid)
    primed.current = true

    if (arrived.length === 0) return

    /**
     * The live region updates even when sound is off, and that is deliberate: it is the only
     * arrival signal available to someone who cannot hear, so it must not sit behind an audio
     * preference.
     */
    const phrase = arrivalPhrase(arrived)
    setAnnouncement((previous) => ({ text: phrase, seq: previous.seq + 1 }))

    if (!enabled) return

    if (!chime.play()) {
      setBlocked(chime.state() !== 'ready')
      // The chime is the attention-getter; without it the words arrive into a room that was not
      // listening. Say them anyway -- half a signal beats none.
    }

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
  const toggle = useCallback(() => {
    const next = !enabled
    setEnabled(next)

    try {
      window.localStorage.setItem(MUTE_KEY, next ? '0' : '1')
    } catch {
      /* See above -- failing to remember it must not stop it taking effect for this shift. */
    }

    if (!next) {
      announce.stop()
      setBlocked(false)
      return
    }

    /**
     * This click is the gesture, so it is the one reliable chance to start the audio context.
     *
     * Awaited rather than checked on a later tick: `resume()` settles on the audio thread, and the
     * previous version read the context state from a `setTimeout(0)` that raced it -- reporting
     * "blocked" and staying silent on a device where sound in fact worked.
     */
    void chime.playPreview().then((ok) => {
      setBlocked(!ok)
      if (!ok) return
      // Confirms both halves of what was just switched on, and proves the voice works before a
      // real order depends on it.
      void announce.unlock()
      speakTimer.current = setTimeout(() => announce.speak('Sound on'), SPEAK_DELAY_MS)
    })
  }, [enabled])

  return { enabled, toggle, blocked, announcement }
}
