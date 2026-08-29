import { formatINR, STAFF_STATUS_LABEL, TRANSITION_VERB } from '@tablex/shared'
import { cn } from '@tablex/ui'
import { MockDescription } from './shell'

/**
 * The admin order board, redrawn.
 *
 * Every string here comes from `packages/shared`: the pills are `STAFF_STATUS_LABEL` values, the
 * buttons are `TRANSITION_VERB` values, and the pill colours are the real `--tx-tone-*` variables
 * rather than hand-picked greens and blues. "Patio 1" is a real seeded table label, which is the
 * quiet way of showing that a table label is a string a restaurant chooses, not a number we
 * assign.
 *
 * The palette is the diner app's warm one, because that is the only palette this app has. The
 * caption under the light variant says so — the real panel is a separate app with a deliberately
 * cool palette (D11), and an unlabelled warm screenshot of it would be a pixel claim that is
 * simply untrue.
 */

interface Ticket {
  number: string
  meta: string
  status: 'preparing' | 'placed' | 'ready'
  lines: readonly string[]
  totalMinor: number
  /** The status this ticket's button moves it INTO. */
  action: 'preparing' | 'accepted' | 'served'
}

const TICKETS: readonly Ticket[] = [
  {
    number: 'A-014',
    meta: 'Table 4 · 2 min ago',
    status: 'preparing',
    lines: ['2 × Paneer Tikka', '1 × Dal Makhani'],
    totalMinor: 82000,
    action: 'preparing',
  },
  {
    number: 'A-015',
    meta: 'Table 9 · just now',
    status: 'placed',
    lines: ['1 × Butter Chicken'],
    totalMinor: 38000,
    action: 'accepted',
  },
  {
    number: 'A-013',
    meta: 'Patio 1 · 14 min ago',
    status: 'ready',
    lines: ['1 × Chicken Tikka', '2 × Butter Naan'],
    totalMinor: 102000,
    action: 'served',
  },
]

const TONE_STYLE: Record<Ticket['status'], { background: string; color: string }> = {
  placed: { background: 'var(--tx-tone-new-bg)', color: 'var(--tx-tone-new-fg)' },
  preparing: { background: 'var(--tx-tone-progress-bg)', color: 'var(--tx-tone-progress-fg)' },
  ready: { background: 'var(--tx-tone-ready-bg)', color: 'var(--tx-tone-ready-fg)' },
}

export function BoardMock({
  variant,
  className,
}: {
  variant: 'hero' | 'light' | 'dark'
  className?: string
}) {
  const dark = variant === 'dark'
  const tickets = variant === 'hero' ? TICKETS.slice(0, 2) : TICKETS

  return (
    <div className={cn(dark ? 'mk-dark' : undefined, className)}>
      <div aria-hidden="true">
        {variant === 'dark' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tickets.map((t, i) => (
              <TicketCard
                key={t.number}
                ticket={t}
                dark
                // The middle ticket rides low so the board reads as live rather than as a
                // perfectly aligned table of three.
                className={i === 1 ? 'lg:translate-y-6' : undefined}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              'rounded-[1.25rem] border border-line bg-surface p-4 shadow-card',
              variant === 'hero' && 'shadow-[0_12px_30px_-18px_rgb(28_25_23/0.28)]',
            )}
          >
            <div className="flex items-center gap-3 border-b border-line pb-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[1.125rem] font-semibold leading-[1.3] text-ink">
                  Spice Garden
                </p>
              </div>
              {variant === 'hero' ? (
                <span className="relative flex h-[6px] w-[6px] shrink-0 items-center justify-center">
                  <span className="mk-ping absolute h-[6px] w-[6px] rounded-full bg-accent" />
                  <span
                    className="mk-ping absolute h-[6px] w-[6px] rounded-full bg-accent"
                    style={{ animationDelay: '1.2s' }}
                  />
                  <span className="relative h-[6px] w-[6px] rounded-full bg-accent" />
                </span>
              ) : null}
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[0.8125rem] text-muted">Accepting orders</span>
                {/* A drawn switch, not a real one: the state it shows is a fact about the
                    product (D18), and a control here would invite a tap that does nothing. */}
                <span className="flex h-[22px] w-[38px] items-center rounded-full bg-accent px-[2px]">
                  <span className="ml-auto h-[18px] w-[18px] rounded-full bg-white" />
                </span>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {tickets.map((t) => (
                <TicketCard key={t.number} ticket={t} dark={false} />
              ))}
            </div>
          </div>
        )}
      </div>
      <MockDescription>
        The staff order board for Spice Garden, accepting orders. Order A-014 for Table 4, placed
        two minutes ago, preparing, two Paneer Tikka and one Dal Makhani, ₹820.00. Order A-015 for
        Table 9, just now, new, one Butter Chicken, ₹380.00.
        {variant === 'hero'
          ? ''
          : ' Order A-013 for Patio 1, fourteen minutes ago, ready, one Chicken Tikka and two Butter Naan, ₹1,020.00.'}
      </MockDescription>
    </div>
  )
}

function TicketCard({
  ticket,
  dark,
  className,
}: {
  ticket: Ticket
  dark: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        dark
          ? 'rounded-card border border-white/10 bg-[var(--mk-surface-dark)] p-5'
          : 'rounded-card border border-line bg-bg p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'font-display text-[1.125rem] font-semibold leading-tight tabular-nums',
              dark ? 'text-bg' : 'text-ink',
            )}
          >
            {ticket.number}
          </p>
          <p className={cn('mt-0.5 text-[0.8125rem]', dark ? 'text-line' : 'text-muted')}>
            {ticket.meta}
          </p>
        </div>
        {/* The real tone variables, inline: they are theme values, not Tailwind colours, and
            arbitrary-value classes for all five tones would be five strings to keep in sync. */}
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold"
          style={TONE_STYLE[ticket.status]}
        >
          {STAFF_STATUS_LABEL[ticket.status]}
        </span>
      </div>
      <ul
        className={cn(
          'mt-3 space-y-1 text-[0.9375rem]',
          dark ? 'text-[var(--mk-text-dark)]' : 'text-muted',
        )}
      >
        {ticket.lines.map((line) => (
          <li key={line} className="tabular-nums">
            {line}
          </li>
        ))}
      </ul>
      <div
        className={cn(
          'mt-3 flex items-center justify-between border-t pt-3',
          dark ? 'border-[var(--mk-rule-dark)]' : 'border-line',
        )}
      >
        <span
          className={cn(
            'text-[0.9375rem] font-semibold tabular-nums',
            dark ? 'text-bg' : 'text-ink',
          )}
        >
          {formatINR(ticket.totalMinor)}
        </span>
        <span className="rounded-card bg-accent px-3 py-1.5 text-[0.8125rem] font-semibold text-accent-ink">
          {TRANSITION_VERB[ticket.action]}
        </span>
      </div>
    </div>
  )
}
