import { cn } from '@tablex/ui'

export interface SwitchTrackProps {
  on: boolean
  /**
   * The colour of the ON state. Accent is the default; `danger` is for a switch whose OFF state is
   * the one that needs noticing, where a green-ish "all fine" would undersell it.
   */
  tone?: 'accent' | 'success'
  className?: string
}

/**
 * The track and thumb of a switch. PRESENTATION ONLY.
 *
 * Deliberately not a control: it renders `aria-hidden` and carries no role, no handler and no
 * label. The caller supplies the real element and its semantics, because the two places this is
 * used need different ones -- a settings row is a toggle button (`aria-pressed`), while the
 * open/close control is a switch (`role="switch"`, `aria-checked`). Baking either in here would
 * force the other to fight it.
 *
 * A track rather than the word "on", which is the point sound-setting.tsx made first: the state is
 * what matters and it has to be readable at a glance, without parsing a label. A button whose text
 * flips between "Open" and "Closed" reads as an instruction as much as a state -- "Closed" is as
 * easily "click to close" as "we are closed" -- and a track has no such ambiguity, because the
 * position IS the state.
 */
export function SwitchTrack({ on, tone = 'accent', className }: SwitchTrackProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        on ? (tone === 'success' ? 'bg-success' : 'bg-accent') : 'bg-line-strong',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-[left] duration-200 ease-out',
          // Honoured rather than assumed: the thumb slides, and a diner-facing app is not the only
          // place someone sets reduce-motion.
          'motion-reduce:transition-none',
          on ? 'left-[1.125rem]' : 'left-0.5',
        )}
      />
    </span>
  )
}
