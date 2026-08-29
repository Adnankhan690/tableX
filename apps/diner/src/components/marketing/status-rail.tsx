import { cn } from '@tablex/ui'

/**
 * The order lifecycle as a rail.
 *
 * The five labels are the diner's forward path from `DINER_PROGRESS_STEPS`, shortened the way
 * `order-tracking.tsx` shortens them — five full `DINER_STATUS_LABEL` strings ("Ready — at your
 * table shortly") do not fit across a phone, which that screen already learned.
 *
 * Width, not viewport, decides the layout, because this renders at two very different sizes:
 *
 * - Full width (the reliability section) uses the horizontal rail from `md` up. Below that the
 *   five labels stack into a vertical rail with a connecting segment between the nodes, rather
 *   than a two-column grid that orphaned "Served" on its own row and dropped the track entirely.
 * - `compact` (a step visual in "How it works", capped at 220px) can never fit five labels across
 *   — at that width they collide into each other — so it keeps the five nodes and captions only
 *   the step the rail is at.
 */
const STEPS = ['Placed', 'Confirmed', 'Cooking', 'Ready', 'Served'] as const

/** Index of the step the rail is "at". The fill and the ping are both derived from it. */
const CURRENT = 2

export function StatusRail({
  dark = false,
  compact = false,
  className,
}: {
  dark?: boolean
  compact?: boolean
  className?: string
}) {
  if (compact) return <CompactRail dark={dark} className={className} />

  return (
    <div className={cn('relative', className)} aria-hidden="true">
      {/* The track and its fill are siblings at the same geometry, so the fill can be a pure
          scaleX transform -- a width animation would be a layout animation on every frame. */}
      <div
        className={cn(
          'absolute inset-x-0 top-[5px] hidden h-[2px] md:block',
          dark ? 'bg-[var(--mk-rule-dark)]' : 'bg-surface-sunken',
        )}
      />
      <div className="mk-rail-fill absolute inset-x-0 top-[5px] hidden h-[2px] bg-accent md:block" />
      <ol className="relative grid grid-cols-1 md:grid-cols-5">
        {STEPS.map((label, i) => {
          const reached = i <= CURRENT
          return (
            <li
              key={label}
              className="relative flex items-center gap-3 py-2 md:flex-col md:items-center md:gap-0 md:py-0"
            >
              {/* The vertical track, drawn per gap so it only exists between two nodes. On the
                  horizontal rail the single full-width track above does this job instead. */}
              {i < STEPS.length - 1 ? (
                <span
                  className={cn(
                    'absolute left-[4px] top-[calc(50%+5px)] h-[calc(100%-10px)] w-[2px] md:hidden',
                    i < CURRENT
                      ? 'bg-accent'
                      : dark
                        ? 'bg-[var(--mk-rule-dark)]'
                        : 'bg-surface-sunken',
                  )}
                />
              ) : null}
              <Node index={i} dark={dark} />
              <span
                className={cn(
                  'text-[0.8125rem] md:mt-3 md:text-center',
                  reached
                    ? dark
                      ? 'font-medium text-bg'
                      : 'font-medium text-ink'
                    : dark
                      ? 'text-white/55'
                      : 'text-muted',
                  // On the stacked rail the pending labels are dimmed rather than emphasised, so
                  // five labels down a narrow column still have one obvious focus.
                  !reached && 'max-md:opacity-70',
                )}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * The rail at step-visual size: five nodes across, one caption.
 *
 * The nodes are `justify-between` rather than a five-column grid so the first and last sit flush
 * with the ends, which lets the track run between node centres instead of past them.
 */
function CompactRail({ dark, className }: { dark: boolean; className?: string }) {
  return (
    <div className={cn('relative', className)} aria-hidden="true">
      <div className="relative">
        <div
          className={cn(
            'absolute inset-x-[5px] top-[4px] h-[2px]',
            dark ? 'bg-[var(--mk-rule-dark)]' : 'bg-surface-sunken',
          )}
        />
        <div className="mk-rail-fill absolute inset-x-[5px] top-[4px] h-[2px] bg-accent" />
        <ol className="relative flex items-center justify-between">
          {STEPS.map((label, i) => (
            <li key={label} className="flex">
              <Node index={i} dark={dark} />
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-3 truncate text-[0.8125rem]">
        <span className={cn('font-medium', dark ? 'text-bg' : 'text-ink')}>{STEPS[CURRENT]}</span>
        <span className={dark ? 'text-white/55' : 'text-muted'}>
          {' · '}
          {CURRENT + 1} of {STEPS.length}
        </span>
      </p>
    </div>
  )
}

/** One node on the rail: the dot, plus the ping when it is the step the rail is at. */
function Node({ index, dark }: { index: number; dark: boolean }) {
  return (
    <span className="relative flex h-[10px] w-[10px] shrink-0 items-center justify-center">
      {index === CURRENT ? (
        <>
          {/* The only infinite animation on the page, and it is removed rather than stopped
              under prefers-reduced-motion -- see marketing.css. */}
          <span className="mk-ping absolute h-[10px] w-[10px] rounded-full bg-accent" />
          <span
            className="mk-ping absolute h-[10px] w-[10px] rounded-full bg-accent"
            style={{ animationDelay: '1.2s' }}
          />
        </>
      ) : null}
      <span
        className={cn(
          'relative h-[10px] w-[10px] rounded-full',
          index <= CURRENT
            ? 'bg-accent'
            : dark
              ? 'bg-[var(--mk-node-pending)] ring-1 ring-[var(--mk-rule-dark)]'
              : 'bg-surface-sunken ring-1 ring-line',
        )}
      />
    </span>
  )
}
