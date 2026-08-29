import { BoardGlyph, MenuGlyph, PricingGlyph, QrPayGlyph } from '../glyphs'
import { Container, SectionHeader } from '../shell'

/**
 * The owner's four reasons, in the owner's words.
 *
 * The rest of this page argues mechanism -- one transaction, eight states, integer paise. That is
 * the right argument for whether the software is any good, and the wrong one for whether to buy
 * it: a restaurant owner is not shopping for a state machine, they are short-staffed on a Friday
 * and tired of arguing about an order somebody misheard.
 *
 * So this section sits early, before any of that, and names the four problems. Each one still
 * points at a real mechanism -- the claim underneath has to be true -- but the headline is the
 * complaint, not the implementation.
 *
 * Deliberately NO numbers in these claims. "Tables turn 20% faster" is the shape of sentence that
 * belongs here and we have not measured it on a single restaurant, so it would be invention
 * dressed as a benefit. Every line below is a description of what changes, which is checkable.
 */

const REASONS = [
  {
    Glyph: QrPayGlyph,
    title: 'Nobody waits to be noticed',
    body: 'The wait for a waiter to come over stops existing. A table that sits down can order in the same minute, and a second round does not need anyone flagged down.',
  },
  {
    Glyph: BoardGlyph,
    title: 'Your staff stop being order-takers',
    body: 'The order arrives at the kitchen already written down and already priced. The people on your floor go back to carrying food and looking after tables.',
  },
  {
    Glyph: MenuGlyph,
    title: 'No more misheard orders',
    body: 'The diner picks the dish from your own menu and reads their own cart back before confirming. Nothing is repeated across a noisy room, so nothing is repeated wrong.',
  },
  {
    Glyph: PricingGlyph,
    title: 'Nothing to download, nothing to buy',
    body: 'It opens in the browser already on their phone — no app, no account, no OTP. On your side there is no terminal and no POS box to integrate with.',
  },
] as const

export function WhyItPays() {
  return (
    <section
      aria-labelledby="why-h"
      id="why"
      className="border-b border-line bg-surface py-16 md:py-24 lg:py-28"
    >
      <Container>
        <SectionHeader
          id="why-h"
          eyebrow="Why restaurants put it on the table"
          title="Four things stop happening on your floor."
          lead="Every one of them is a thing your staff currently do by hand, in the middle of service."
        />

        <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:mt-14 lg:gap-x-12">
          {REASONS.map(({ Glyph, title, body }, i) => (
            <div
              key={title}
              className="mk-reveal flex gap-4"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {/* The glyph is a fixed 40px square so the four headlines start on the same
                  x-position regardless of which icon sits beside them. */}
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-accent-soft text-accent"
                aria-hidden="true"
              >
                <Glyph size={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[1.0625rem] font-semibold leading-[1.3] text-ink">{title}</h3>
                <p className="mt-1.5 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-muted">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
