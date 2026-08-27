'use client'

import { useCallback, useState } from 'react'
import * as announce from '@/lib/announce'
import * as chime from '@/lib/chime'
import { arrivalPhrase } from '@/lib/new-arrivals'

/**
 * A diagnostic for the new-order sound, outside the board and outside auth.
 *
 * It exists because the sound is the one feature in this panel that cannot be verified by looking
 * at it, and "I am not getting the sound" has at least six causes -- muted device, autoplay
 * gating, no installed voice, a suspended context, a failed unlock, arrival detection -- that all
 * present identically on the board. This separates them: every line below is a fact read back from
 * the browser rather than an assumption.
 *
 * Unauthenticated on purpose: it touches no order data, and needing to sign in to test whether a
 * speaker works is what makes people stop testing.
 */
export default function SoundCheckPage() {
  const [log, setLog] = useState<string[]>([])
  const add = useCallback((line: string) => setLog((l) => [...l, line]), [])

  const report = useCallback(() => {
    add(`chime.state() = ${chime.state()}`)
    add(`announce.state() = ${announce.state()}`)
    const voices = typeof window !== 'undefined' ? window.speechSynthesis?.getVoices() : undefined
    add(`voices installed = ${voices ? voices.length : 'no speechSynthesis'}`)
    if (voices?.length) {
      add(
        `  english voices: ${
          voices
            .filter((v) => v.lang.startsWith('en'))
            .map((v) => `${v.name} (${v.lang})`)
            .join(', ') || 'NONE'
        }`,
      )
    }
  }, [add])

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-title font-semibold">Sound check</h1>
      <p className="text-sm text-muted">
        Each button reports what the browser actually did. Turn the device volume up first.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-tap rounded-control border border-accent bg-accent px-3 text-sm font-medium text-accent-ink"
          onClick={() => {
            add('--- chime.playPreview() ---')
            void chime.playPreview().then((ok) => {
              add(`playPreview resolved: ${ok}`)
              report()
            })
          }}
        >
          Test chime
        </button>

        <button
          type="button"
          className="min-h-tap rounded-control border border-line-strong bg-surface px-3 text-sm font-medium"
          onClick={() => {
            add('--- announce.speak() ---')
            void announce.unlock()
            const phrase = arrivalPhrase([{ table_label: '7' }])
            add(`phrase = "${phrase}"`)
            add(`speak returned: ${announce.speak(phrase)}`)
            report()
          }}
        >
          Test speech
        </button>

        <button
          type="button"
          className="min-h-tap rounded-control border border-line-strong bg-surface px-3 text-sm font-medium"
          onClick={() => {
            add('--- full arrival sequence ---')
            void chime.playPreview().then((ok) => {
              add(`chime: ${ok}`)
              void announce.unlock()
              setTimeout(() => {
                add(`speech: ${announce.speak(arrivalPhrase([{ table_label: '7' }]))}`)
                report()
              }, 520)
            })
          }}
        >
          Simulate a new order
        </button>

        <button
          type="button"
          className="min-h-tap rounded-control border border-line px-3 text-sm text-muted"
          onClick={() => setLog([])}
        >
          Clear
        </button>
      </div>

      <pre className="figures overflow-x-auto rounded-card border border-line bg-surface-sunken p-3 text-xs leading-relaxed">
        {log.length === 0 ? 'Nothing yet. Press a button.' : log.join('\n')}
      </pre>
    </main>
  )
}
