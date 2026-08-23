import { cn } from './cn'

export interface SpinnerProps {
  /** Edge length in px. */
  size?: number
  /** Announced while the wait lasts; override it when the wait has a specific subject. */
  label?: string
  className?: string
}

/**
 * An inline busy indicator.
 *
 * Hand-drawn SVG plus one Tailwind keyframe rather than an animation library: a spinner is
 * two shapes and a rotation, and this sits on the diner app's critical path on 3G (PRD 7),
 * where every imported kilobyte is a kilobyte a hungry person waits for.
 *
 * `currentColor` on both strokes means it inherits the colour of the button or line of text
 * it sits inside, so neither app has to hand it a palette.
 */
export function Spinner({ size = 16, label = 'Loading', className }: SpinnerProps) {
  return (
    // A live region carrying real text, rather than an aria-label on the glyph. The label
    // has to be announceable content: a spinner that says nothing is silence to a screen
    // reader user, who then cannot tell "still working" from "finished with nothing to show".
    <output className={cn('inline-flex items-center', className)} data-spinner="">
      <svg
        className="animate-spin shrink-0"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {/* The faint full ring gives the moving arc something to travel along. */}
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </output>
  )
}
