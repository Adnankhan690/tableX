/**
 * The new-order chime.
 *
 * Why sound exists in this panel at all, since it is the only sound in the whole product: staff
 * are not looking at this screen. They are at the pass with their hands full, and the board is on
 * a tablet behind them. Every visual signal the board has -- the age tint, the `placed` badge, the
 * chip count -- only reaches someone already facing it. A chime reaches someone with their back
 * turned, which is the actual failure mode this addresses (PRD 3, orders processed per hour).
 *
 * SYNTHESISED, NOT A FILE. Two reasons, in order of weight:
 *
 *  1. An <audio> element needs an asset, and an asset needs a fetch. This board is opened once at
 *     the start of a shift on restaurant wifi; a chime that 404s or is still downloading during
 *     the first rush is a chime that does not exist. Oscillators cannot fail to load.
 *  2. docs/ARCHITECTURE.md commits this repo to no animation library, and the same reasoning
 *     applies to audio: Web Audio is already in the browser. This file is the dependency.
 *
 * AUTOPLAY IS THE WHOLE DIFFICULTY. Every browser starts an AudioContext `suspended` and will only
 * resume it inside a user gesture. That makes silent failure the default, and a silent failure here
 * is worse than having no chime: staff would stop watching the board because they were told it
 * would tell them. So `state()` reports `blocked` and the board says so out loud, rather than this
 * module pretending it played.
 */

/** What the chime can currently do. `unsupported` is a browser with no Web Audio at all. */
export type ChimeState = 'ready' | 'blocked' | 'unsupported'

type AudioContextCtor = typeof AudioContext

/**
 * One context for the page, built on first use rather than at import.
 *
 * Not at import because constructing an AudioContext outside a gesture logs a console warning in
 * Chrome and counts against a per-page limit; and this module is imported by a page that may never
 * chime (sound muted for the shift).
 */
let ctx: AudioContext | null = null
let unsupported = false

function context(): AudioContext | null {
  if (unsupported || typeof window === 'undefined') return null
  if (ctx) return ctx

  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) {
    unsupported = true
    return null
  }
  try {
    ctx = new Ctor()
  } catch {
    // Some locked-down embedded browsers throw on construction rather than omitting the API.
    unsupported = true
    return null
  }
  return ctx
}

export function state(): ChimeState {
  const audio = context()
  if (!audio) return 'unsupported'
  return audio.state === 'running' ? 'ready' : 'blocked'
}

/**
 * Moves the context out of `suspended`, if the caller is inside a user gesture.
 *
 * ASYNC, AND THE CALLER MUST AWAIT IT. `resume()` hops to the audio thread, so the context is
 * still `suspended` for some time after the call returns -- a caller that fires it and then checks
 * `state()` on the next tick reads the OLD state, concludes it is blocked, and stays silent. That
 * was a real bug here: the toggle unlocked correctly and then reported failure on a `setTimeout(0)`
 * that raced the resume.
 *
 * Safe and cheap to call on every gesture -- `resume()` on a running context is a no-op. It stays
 * separate from `play` because the gesture that unlocks audio (signing in, tapping a filter) is
 * never the event that wants a sound.
 *
 * Resolves with whether the context is actually usable now.
 */
export async function unlock(): Promise<boolean> {
  const audio = context()
  if (!audio) return false
  if (audio.state === 'suspended') {
    try {
      await audio.resume()
    } catch {
      // No gesture credit. `state()` keeps reporting `blocked` and the board keeps saying so.
      return false
    }
  }
  return audio.state === 'running'
}

/** A5 up to D6: a perfect fourth. Rising, so it reads as a question, not an alarm. */
const NOTES = [880, 1174.66]

/** Seconds between the two notes' onsets. They overlap, which is what makes it a chime. */
const NOTE_GAP = 0.13
const NOTE_DECAY = 0.32

/**
 * Peak gain per note.
 *
 * Deliberately modest. A kitchen is loud, so the temptation is to push this up -- but the tablet's
 * own volume control is the right place to solve room noise, and a chime mixed hot here is one
 * that cannot be made pleasant at the other end. If a restaurant reports it is inaudible over an
 * extractor fan, raise the device volume before this number.
 */
const PEAK = 0.16

/**
 * The minimum silence between two chimes.
 *
 * The board refetches on a socket ping or every 5s, and one refetch can reveal three new orders at
 * once during a rush. Three chimes stacked inside 400ms is a noise, not a signal -- and the staff
 * member has already looked up by the second one. So arrivals coalesce: one chime means "something
 * new is on the board", never "exactly one thing is".
 */
const MIN_GAP_MS = 1_500
let lastPlayedAt = 0

/**
 * Plays the chime. Returns false if it did not sound, so the caller can tell the difference
 * between "announced" and "silently swallowed".
 *
 * Must be called from a context that is already running -- see `unlock`. It deliberately does NOT
 * resume-then-play: `resume()` settles whenever the next gesture happens, which could be four
 * minutes later, and a chime for an order that has since been served is worse than no chime.
 */
export function play(now = Date.now()): boolean {
  const audio = context()
  if (!audio || audio.state !== 'running') return false
  if (now - lastPlayedAt < MIN_GAP_MS) return false
  lastPlayedAt = now

  const start = audio.currentTime

  NOTES.forEach((frequency, index) => {
    const at = start + index * NOTE_GAP

    const osc = audio.createOscillator()
    // Triangle rather than sine: a pure sine is the first thing to disappear under broadband
    // kitchen noise, and triangle's odd harmonics carry without sounding like a buzzer.
    osc.type = 'triangle'
    osc.frequency.value = frequency

    const gain = audio.createGain()
    // Ramped, never assigned: stepping gain from 0 to peak puts a discontinuity in the waveform,
    // which is audible as a click in front of the note.
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(PEAK, at + 0.008)
    // To 0.0001 and not 0, because an exponential ramp to zero is undefined and silently does
    // nothing -- leaving the note ringing until the oscillator is cut off, click included.
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_DECAY)

    osc.connect(gain).connect(audio.destination)

    // Nodes are single-use and the graph would otherwise grow by two per chime for the whole
    // shift, so each note disposes of itself. Assigned BEFORE `start`/`stop` rather than after:
    // the handler would in fact still catch an event 320ms in the future, but ordering it this way
    // means the cleanup does not depend on that timing being true.
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }

    osc.start(at)
    osc.stop(at + NOTE_DECAY)
  })

  return true
}

/**
 * Plays the chime as a confirmation, bypassing the coalescing gap.
 *
 * Used when a staff member unmutes: the tap is both the gesture that unlocks audio and the moment
 * they need to hear what they have just switched on. Without this, unmuting is silent and there is
 * no way to find out whether sound works except waiting for a real order.
 *
 * Unlocks first and AWAITS it, unlike `play`. This is the one path that is guaranteed to be inside
 * a user gesture, so it is the one path that can legitimately start the context -- and the only
 * one that can report back truthfully whether sound works on this device.
 */
export async function playPreview(): Promise<boolean> {
  const ready = await unlock()
  if (!ready) return false
  lastPlayedAt = 0
  return play()
}
