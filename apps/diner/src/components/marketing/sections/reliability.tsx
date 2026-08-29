import { BoardMock } from '../board-mock'
import { Container, SectionHeader } from '../shell'
import { StatusRail } from '../status-rail'

/**
 * The one inverted section on the page.
 *
 * It is here rather than behind a pricing tier because this is where the AUDIENCE switches: every
 * section above is about what a diner sees, and everything from here down is about what an owner
 * is trusting us with. The product is literally two apps with two deliberately unalike palettes
 * (D11), so the inversion is true to its own design system rather than decorative.
 *
 * It is one inverted band and NOT a dark mode: `color-scheme: light` is untouched, no
 * `prefers-color-scheme` block is added anywhere, and the ground is the existing --tx-ink token.
 *
 * CONTRAST IS THE CONSTRAINT HERE. On this ground `text-muted` measures 3.03:1 and `text-accent`
 * 3.36:1 — both fail, and neither may carry text. The legal set is `text-bg` (16.3:1) for
 * headings, `--mk-text-dark` (8.6:1) for body, `text-line` (12.97:1) for meta, and
 * `text-accent-soft` (~13:1) for the eyebrow. Accent stays as a fill and as graphics.
 */

const PILLARS = [
  {
    title: 'One transaction.',
    body: 'The idempotency check, cart validation, server-side pricing, the day’s order number under a row lock, the items and the first status event. All of it, or none of it. A double-tapped “Place order” on a stalled connection returns the original — it cannot send the kitchen a second one.',
  },
  {
    title: 'Eight states, one table.',
    body: 'Six forward, two ways out. The server tells each screen which moves are legal, so two staff phones tapping Accept in the same second cannot both win.',
  },
  {
    title: 'Live, with a real fallback.',
    body: 'The socket carries a hint; the client refetches the truth. A dropped frame is harmless, and polling is a complete substitute rather than a degraded mode.',
  },
  {
    title: 'Numbers stay integers.',
    body: 'Money is integer paise end to end and tax is basis points. No float ever touches a bill, and an order line keeps its own snapshot of the name, price and food type — so editing your menu never rewrites yesterday’s receipt.',
  },
] as const

export function Reliability() {
  return (
    <section
      aria-labelledby="rel-h"
      id="reliability"
      className="mk-dark relative overflow-hidden bg-ink py-16 md:py-24 lg:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_55%_at_50%_0%,var(--mk-glow),transparent_62%)]"
        aria-hidden="true"
      />
      <Container className="relative">
        <SectionHeader
          id="rel-h"
          dark
          eyebrow="Reliability"
          title="An order that cannot be lost."
          lead="The one failure this product cannot have is a diner who paid for an order the kitchen never saw. So placing an order is a single transaction, and the lifecycle is a table the server enforces — not a convention the apps agree to follow."
        />

        <StatusRail dark className="mt-12 max-w-[720px]" />

        <div className="mt-12 grid grid-cols-1 divide-y divide-[var(--mk-rule-dark)] md:grid-cols-2 md:divide-x lg:grid-cols-4 lg:divide-y-0">
          {PILLARS.map((pillar, i) => (
            <div
              key={pillar.title}
              className="mk-reveal py-6 lg:px-6 lg:py-0"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <h3 className="text-[1.125rem] font-semibold leading-[1.3] text-bg">
                {pillar.title}
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-[1.62] text-[var(--mk-text-dark)]">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>

        <BoardMock variant="dark" className="mt-12" />
      </Container>
    </section>
  )
}
