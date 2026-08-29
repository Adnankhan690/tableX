import { cn } from '@tablex/ui'

/**
 * The order lifecycle as a rail.
 *
 * The five labels are the diner's forward path from `DINER_PROGRESS_STEPS`, shortened the way
 * `order-tracking.tsx` shortens them — five full `DINER_STATUS_LABEL` strings ("Ready — at your
 * table shortly") do not fit across a phone, which that screen already learned. Below 640px only
 * the current step keeps full emphasis, for the same reason.
 */
const STEPS = ['Placed', 'Confirmed', 'Cooking', 'Ready', 'Served'] as const

/** Index of the step the rail is "at". The fill and the ping are both derived from it. */
const CURRENT = 2

export function StatusRail({ dark = false, className }: { dark?: boolean; className?: string }) {
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
      <ol className="relative grid grid-cols-2 gap-y-4 md:grid-cols-5 md:gap-y-0">
        {STEPS.map((label, i) => {
          const reached = i <= CURRENT
          return (
            <li key={label} className="flex flex-col items-start md:items-center">
              <span className="relative flex h-[10px] w-[10px] items-center justify-center">
                {i === CURRENT ? (
                  <>
                    {/* The only infinite animation on the page, and it is removed rather than
                        stopped under prefers-reduced-motion -- see marketing.css. */}
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
                    reached
                      ? 'bg-accent'
                      : dark
                        ? 'bg-[var(--mk-node-pending)] ring-1 ring-[var(--mk-rule-dark)]'
                        : 'bg-surface-sunken ring-1 ring-line',
                  )}
                />
              </span>
              <span
                className={cn(
                  'mt-3 text-[0.8125rem] md:text-center',
                  reached
                    ? dark
                      ? 'font-medium text-bg'
                      : 'font-medium text-ink'
                    : dark
                      ? 'text-white/55'
                      : 'text-muted',
                  // Below 640px the pending labels are dimmed rather than emphasised, so five
                  // labels across a narrow column still have one obvious focus.
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
