/**
 * The spoken new-order announcement.
 *
 * Sits BEHIND the chime, never instead of it, and the ordering is the whole design. Speech is the
 * weaker signal in this room: intelligibility needs a positive signal-to-noise ratio across the
 * 300-3000Hz band, and a kitchen's broadband noise -- extractor fans, dishwashers, a full pass --
 * eats exactly that band. A tonal chime only has to clear the noise floor at two narrow
 * frequencies. So the chime wins attention and the speech delivers the one thing a chime cannot
 * carry: which table. It is the airport-PA pattern, and it is the reason this is worth having.
 *
 * Read the caveats before tuning anything here:
 *
 *  - THE SPEECH IS NOT THE RECORD. Staff act on the board, not on what they thought they heard. A
 *    misheard table number costs nothing because the ticket is on screen; that is what makes it
 *    safe to say a number out loud at all.
 *  - VOICES ARE THE DEVICE'S, NOT OURS. `getVoices()` is empty until the engine loads, varies by
 *    OS, and Android WebView often ships none at all. Every path here degrades to "the chime still
 *    played", never to a thrown error mid-service.
 *  - LANGUAGE IS A REAL LIMIT. This picks en-IN where the device has it, then any English. Kitchen
 *    staff who do not read English get a table number in a language they may not speak, which is
 *    why the chime -- language-neutral -- stays the primary signal.
 */

/** What speech can currently do. */
export type AnnounceState = 'ready' | 'blocked' | 'unsupported'

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  return window.speechSynthesis ?? null
}

/**
 * Preferred in order, most specific first.
 *
 * en-IN first because this is an Indian restaurant platform and an Indian English voice says table
 * numbers and Indian names closer to how the room says them. en-GB before en-US on the same
 * reasoning. Anything English is better than a device default that might be reading English text
 * with, say, German phonemes.
 */
const VOICE_PREFERENCE = ['en-IN', 'en-GB', 'en-AU', 'en-US', 'en']

let cachedVoice: SpeechSynthesisVoice | null = null
let voicesBound = false
let blocked = false

function pickVoice(): SpeechSynthesisVoice | null {
  const speech = synth()
  if (!speech) return null
  if (cachedVoice) return cachedVoice

  const voices = speech.getVoices()
  // Empty on first call in Chrome and Safari: the engine populates asynchronously and fires
  // `voiceschanged`. Returning null here is correct -- speaking with no voice set uses the device
  // default, which is a reasonable answer for the first announcement of a shift.
  if (voices.length === 0) {
    if (!voicesBound) {
      voicesBound = true
      speech.addEventListener('voiceschanged', () => {
        cachedVoice = null
      })
    }
    return null
  }

  for (const tag of VOICE_PREFERENCE) {
    const match = voices.find((voice) => voice.lang.replace('_', '-').startsWith(tag))
    if (match) {
      cachedVoice = match
      return match
    }
  }
  return null
}

export function state(): AnnounceState {
  if (!synth()) return 'unsupported'
  return blocked ? 'blocked' : 'ready'
}

/**
 * Warms the engine inside a user gesture.
 *
 * Safari will not speak until the page has been interacted with, and unlike an AudioContext there
 * is no state to inspect -- the first utterance simply does nothing. Speaking an empty string is
 * the standard way to spend the gesture without making a noise.
 */
export function unlock(): void {
  const speech = synth()
  if (!speech) return
  try {
    speech.speak(new SpeechSynthesisUtterance(''))
    pickVoice()
  } catch {
    /* Nothing to recover; `speak` below reports for itself. */
  }
}

/**
 * Says one line. Returns false if it certainly did not speak.
 *
 * `cancel()` first, deliberately: during a rush the board can announce again while the previous
 * line is still going, and the queue would otherwise back up into several seconds of talking over
 * a kitchen. The newest arrival is the useful one, so it interrupts rather than waits.
 */
export function speak(text: string): boolean {
  const speech = synth()
  if (!speech || !text) return false

  try {
    speech.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice()
    if (voice) {
      utterance.voice = voice
      // Normalised: some platforms report `en_IN`, which is not a valid BCP-47 tag. Harmless while
      // `voice` is set and takes precedence, but an invalid tag is not worth leaving in place.
      utterance.lang = voice.lang.replace('_', '-')
    } else {
      // Matches <html lang> in layout.tsx, so a device with no matching voice at least reads it
      // with English phonemes rather than the OS locale's.
      utterance.lang = 'en-IN'
    }
    // Left at the defaults on purpose. The instinct in a loud room is to speed it up to get it
    // over with, and that is backwards: rate is the first thing to cost intelligibility under
    // noise. Room volume belongs on the tablet's own control.
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1

    utterance.onerror = (event) => {
      // `interrupted` and `canceled` are our own cancel() above, not a failure.
      const reason = (event as SpeechSynthesisErrorEvent).error
      if (reason === 'interrupted' || reason === 'canceled') return
      if (reason === 'not-allowed') blocked = true
    }
    utterance.onstart = () => {
      blocked = false
    }

    speech.speak(utterance)
    return true
  } catch {
    return false
  }
}

/** Stops mid-sentence. Used on unmount so a line does not outlive the board that asked for it. */
export function stop(): void {
  try {
    synth()?.cancel()
  } catch {
    /* Already gone. */
  }
}
