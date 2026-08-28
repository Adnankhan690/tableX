'use client'

import { cn } from '@tablex/ui'
import { Bell, BellOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { SwitchTrack } from '@/components/ui'
import * as announce from '@/lib/announce'
import * as chime from '@/lib/chime'
import { readChimeEnabled, writeChimeEnabled } from '@/lib/chime-preference'

/**
 * The new-order sound control, on Settings.
 *
 * It used to sit in the order board's header beside the live/polling indicator. It is a preference,
 * not a per-shift action -- switched once when a tablet is put on a wall and then left alone -- so
 * the header was paying for it on every render of the one screen staff look at all service.
 *
 * SWITCHING IT ON PLAYS IT. That is the whole reason this is a button and not a checkbox: the tap
 * is simultaneously the user gesture that lets the browser start audio at all (see lib/chime.ts)
 * and the only chance to find out whether this device can actually make a sound. A silent
 * confirmation would leave someone trusting a chime that never comes.
 */
export function SoundSetting() {
  const [enabled, setEnabled] = useState(false)
  /** Set when the browser refused to make a sound -- no gesture credit, or no Web Audio at all. */
  const [blocked, setBlocked] = useState(false)

  // After mount, never in the initialiser: reading storage during render makes the server markup
  // and the first client render disagree, which React reports as a hydration error.
  useEffect(() => {
    setEnabled(readChimeEnabled())
  }, [])

  const toggle = useCallback(() => {
    const next = !enabled
    setEnabled(next)
    writeChimeEnabled(next)

    if (!next) {
      announce.stop()
      setBlocked(false)
      return
    }

    // This click is the gesture, so it is the one reliable chance to start the audio context.
    // Awaited rather than checked on a later tick: `resume()` settles on the audio thread.
    void chime.playPreview().then((ok) => {
      setBlocked(!ok)
      if (!ok) return
      void announce.unlock()
      // After the chime, not over it -- the same 520ms gap the board uses.
      setTimeout(() => announce.speak('Sound on'), 520)
    })
  }, [enabled])

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        className={cn(
          'flex min-h-tap-sm w-full items-center justify-between gap-3 rounded-control border px-3 text-left transition-colors sm:min-h-tap',
          enabled
            ? 'border-accent-line bg-accent-soft'
            : 'border-line-strong bg-surface hover:bg-surface-sunken',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {enabled ? (
            <Bell aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          ) : (
            <BellOff aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          )}
          <span
            className={cn('truncate text-sm font-medium', enabled ? 'text-accent' : 'text-ink')}
          >
            {enabled ? 'Chime and announce the table' : 'Silent'}
          </span>
        </span>
        {/* A track, not the word "on": the state is what matters and it is read at a glance. */}
        <SwitchTrack on={enabled} />
      </button>

      {blocked ? (
        <p className="text-xs font-medium text-warning">
          This browser has not allowed sound yet. Tap anywhere on the page, then switch it on again.
        </p>
      ) : (
        <p className="text-xs text-muted">
          {/* Says per-device out loud, because every other row on this page is restaurant-wide and
              saved to the server. A manager should not think they have set this for the kitchen. */}
          Applies to this device only. Other tablets and phones keep their own setting.
        </p>
      )}
    </div>
  )
}
