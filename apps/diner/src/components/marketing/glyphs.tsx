import { cn } from '@tablex/ui'

/**
 * Every mark on the marketing page, as inline SVG.
 *
 * No icon library, and none may be added: PRD §7 makes payload a product requirement for this
 * app and the enforcement is omission (docs/CONTRIBUTING.md). The feature glyphs all share one
 * spec — 24-unit box, `stroke-width: 1.75`, round caps and joins, no fills — matching `BackLink`
 * and `FoodTypeBadge`. Mixing stroke weights or stroke-and-fill across a set is the commonest
 * tell of a page assembled from three icon packs.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function Icon({
  children,
  size = 24,
  className,
}: {
  children: React.ReactNode
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      {...STROKE}
    >
      {children}
    </svg>
  )
}

/** The plate seen from above, from app/icon.svg. Reused rather than redrawn. */
export function PlateMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="var(--tx-accent)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="#fff" />
    </svg>
  )
}

/**
 * A 21x21-module QR code, hardcoded.
 *
 * The three finder patterns and the timing runs on row 6 and column 6 are in their real
 * positions, so it reads as a code at a glance rather than as noise in a square. The module
 * array is a committed constant and is never regenerated: a random or date-seeded pattern would
 * differ between the server render and the client hydration, which React resolves by throwing
 * the server HTML away.
 *
 * It is deliberately NOT scannable, and no copy on the page implies it is — the hero caption
 * says "Example", and `/qr` is where real server-generated codes live.
 */
const QR_MODULES: ReadonlyArray<readonly [number, number]> = [
  [8, 0],
  [10, 0],
  [12, 0],
  [8, 1],
  [9, 1],
  [10, 1],
  [8, 2],
  [10, 2],
  [8, 3],
  [9, 3],
  [8, 4],
  [11, 4],
  [12, 4],
  [8, 5],
  [9, 5],
  [10, 5],
  [11, 5],
  [8, 6],
  [10, 6],
  [12, 6],
  [8, 7],
  [9, 7],
  [10, 7],
  [11, 7],
  [12, 7],
  [1, 8],
  [3, 8],
  [5, 8],
  [6, 8],
  [8, 8],
  [9, 8],
  [11, 8],
  [15, 8],
  [16, 8],
  [20, 8],
  [0, 9],
  [1, 9],
  [10, 9],
  [11, 9],
  [12, 9],
  [13, 9],
  [20, 9],
  [2, 10],
  [3, 10],
  [4, 10],
  [5, 10],
  [6, 10],
  [7, 10],
  [9, 10],
  [10, 10],
  [12, 10],
  [13, 10],
  [14, 10],
  [15, 10],
  [18, 10],
  [19, 10],
  [0, 11],
  [4, 11],
  [5, 11],
  [7, 11],
  [8, 11],
  [9, 11],
  [11, 11],
  [14, 11],
  [15, 11],
  [16, 11],
  [17, 11],
  [19, 11],
  [1, 12],
  [3, 12],
  [5, 12],
  [6, 12],
  [10, 12],
  [14, 12],
  [15, 12],
  [17, 12],
  [18, 12],
  [19, 12],
  [8, 13],
  [9, 13],
  [11, 13],
  [12, 13],
  [13, 13],
  [14, 13],
  [15, 13],
  [19, 13],
  [11, 14],
  [12, 14],
  [16, 14],
  [18, 14],
  [9, 15],
  [12, 15],
  [13, 15],
  [15, 15],
  [17, 15],
  [9, 16],
  [10, 16],
  [18, 16],
  [20, 16],
  [9, 17],
  [11, 17],
  [12, 17],
  [13, 17],
  [14, 17],
  [17, 17],
  [18, 17],
  [19, 17],
  [20, 17],
  [8, 18],
  [9, 18],
  [10, 18],
  [11, 18],
  [15, 18],
  [16, 18],
  [17, 18],
  [18, 18],
  [20, 18],
  [8, 19],
  [10, 19],
  [11, 19],
  [14, 19],
  [17, 19],
  [19, 19],
  [9, 20],
  [11, 20],
  [12, 20],
  [15, 20],
  [17, 20],
  [20, 20],
] as const

/** Module origins of the three finder patterns, in module units. */
const FINDERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [14, 0],
  [0, 14],
] as const

export function QrGlyph({ size = 112, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 168 168"
      fill="currentColor"
      // crispEdges, because a 1.5px corner radius on a module scaled to 112px is the whole
      // personality of this mark and antialiasing it into mush would make it look printed badly.
      shapeRendering="crispEdges"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      {FINDERS.map(([fx, fy]) => (
        <g key={`f-${fx}-${fy}`}>
          {/* Inset by half the stroke so the 7x7 module footprint is exact. */}
          <rect
            x={fx * 8 + 4}
            y={fy * 8 + 4}
            width={48}
            height={48}
            rx={8}
            fill="none"
            stroke="currentColor"
            strokeWidth={8}
          />
          <rect x={fx * 8 + 16} y={fy * 8 + 16} width={24} height={24} rx={3} />
        </g>
      ))}
      {QR_MODULES.map(([x, y]) => (
        <rect key={`m-${x}-${y}`} x={x * 8} y={y * 8} width={8} height={8} rx={1.5} />
      ))}
    </svg>
  )
}

/**
 * The veg / non-veg / egg mark, at the exact geometry of `FoodTypeBadge`.
 *
 * Redrawn here rather than imported because the shared component is a `<span>` with its own
 * colour mapping and accessible name, and inside an `aria-hidden` mock both of those are
 * unwanted — the mock's `sr-only` sibling spells out "vegetarian" in prose instead. The
 * geometry is copied so the two never diverge visually.
 */
export function VegMark({
  tone = 'veg',
  size = 14,
  className,
}: {
  tone?: 'veg' | 'nonveg' | 'egg'
  size?: number
  className?: string
}) {
  const toneClass = tone === 'veg' ? 'text-veg' : tone === 'nonveg' ? 'text-nonveg' : 'text-egg'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn('shrink-0', toneClass, className)}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3.4" fill="currentColor" />
    </svg>
  )
}

/** The rating star. `d` copied verbatim from menu-screen.tsx so the two cannot drift. */
export function StarGlyph({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95L12 2.6z" />
    </svg>
  )
}

export function ArrowRight({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      {/* An arrow with a tail, not a bare chevron -- matching BackLink's reasoning in reverse. */}
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </Icon>
  )
}

export function CloseGlyph({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** A menu, as a list with one marked row. */
export function MenuGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 7h13M4 12h13M4 17h9" />
      <rect x="19" y="5.5" width="3" height="3" rx="0.7" />
    </Icon>
  )
}

/** A rupee inside a server-shaped frame: pricing decided on the server, not on the phone. */
export function PricingGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" />
      <path d="M7 6h9M7 10h9M7 6c4 0 5 6 0 6l6 6" />
    </Icon>
  )
}

/** A QR code paying a rupee. */
export function QrPayGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z" />
      <path d="M14 14h3M14 17h3M14 14c2.5 0 3 4 0 4l3 3" />
    </Icon>
  )
}

/** The kitchen board. */
export function BoardGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M2.5 9h19M7 13h10M7 16.5h6" />
    </Icon>
  )
}

/** The accepting-orders switch. */
export function SwitchGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** Two scores kept apart: a star standing on its own baseline. */
export function ScoresGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.4 7.2 17.9l.9-5.4L4.2 8.7l5.4-.8z" />
      <path d="M3 21h18" />
    </Icon>
  )
}
