import { QrGlyph, StarGlyph, VegMark } from '../glyphs'
import { Container, SectionHeader } from '../shell'
import { StatusRail } from '../status-rail'

/**
 * Four steps, in the order they actually happen, and each one is ONE SENTENCE.
 *
 * They were paragraphs. A prospect scanning a page to work out whether this is for them does not
 * read a paragraph in a four-column grid -- the length itself is the signal that they can skip
 * it, so the detail defeated its own purpose. Everything cut from here is still on the page,
 * further down, where somebody who has decided they are interested will actually read it.
 *
 * The fourth step is the kitchen accepting. Three steps ended the story on the diner's phone,
 * which quietly left the owner's half -- the half being sold -- as something they had to take on
 * trust. The loop has to close on the board.
 *
 * Each visual is drawn from the real thing that step produces -- a code, a menu row, a status
 * rail, a board ticket -- rather than a generic icon, so the row reads as a sequence of screens.
 */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-h" id="how-it-works" className="py-16 md:py-24 lg:py-32">
      <Container>
        <SectionHeader
          id="how-h"
          eyebrow="How it works"
          title="Four things happen, in this order."
          lead="Start to finish, about ninety seconds. No hardware to buy and nothing for the diner to download."
        />

        <div className="mt-10 grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x lg:mt-14 lg:grid-cols-4 lg:divide-y-0">
          <Step index="01" title="They scan." visual={<QrGlyph size={48} className="text-ink" />}>
            They point a phone camera at the card on the table. No app, no account, no typing.
          </Step>

          <Step index="02" title="They choose." visual={<MiniMenu />} className="lg:px-8">
            Your whole menu opens with veg and non-veg marked, and they add what they want to a
            cart.
          </Step>

          <Step
            index="03"
            title="They order."
            visual={<StatusRail className="w-full max-w-[220px]" />}
            className="lg:px-8"
          >
            They pay by UPI or choose to settle at the counter, and the order is placed.
          </Step>

          <Step
            index="04"
            title="Your kitchen accepts."
            visual={<MiniTicket />}
            className="lg:pl-8"
          >
            It lands on your board with the table, the items and the total — and the diner watches
            it move from Accepted to Ready without asking anyone.
          </Step>
        </div>
      </Container>
    </section>
  )
}

function Step({
  index,
  title,
  visual,
  children,
  className,
}: {
  index: string
  title: string
  visual: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`mk-reveal py-8 lg:py-2 ${className ?? 'lg:pr-8'}`}>
      <div className="flex h-12 items-end">{visual}</div>
      <p className="mt-5 text-[0.75rem] font-semibold uppercase tracking-[0.14em] tabular-nums text-accent">
        {index}
      </p>
      <h3 className="mt-2 text-[1.125rem] font-semibold leading-[1.3] text-ink">{title}</h3>
      <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-[1.62] text-muted">{children}</p>
    </div>
  )
}

/** One board ticket, at the size a step visual can carry. */
function MiniTicket() {
  return (
    <div
      className="w-full max-w-[220px] rounded-card border border-line bg-surface"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[0.8125rem] font-semibold tabular-nums text-ink">A-014</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-accent">
          New
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[0.75rem] text-muted">Table 6 · just now</p>
        <p className="mt-1 text-[0.8125rem] text-ink">2 × Paneer Tikka</p>
        <p className="mt-2 text-[0.8125rem] font-semibold tabular-nums text-ink">₹680.00</p>
      </div>
    </div>
  )
}

/** Two menu rows, at the size a step visual can carry. */
function MiniMenu() {
  return (
    <div
      className="w-full max-w-[220px] rounded-card border border-line bg-surface"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <VegMark size={11} />
        <span className="flex-1 truncate text-[0.8125rem] font-medium text-ink">Paneer Tikka</span>
        <StarGlyph size={9} className="text-accent" />
        <span className="text-[0.75rem] tabular-nums text-ink">4.8</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 opacity-55">
        <VegMark size={11} />
        <span className="flex-1 truncate text-[0.8125rem] font-medium text-ink">Kadai Paneer</span>
        <span className="text-[0.6875rem] font-medium text-nonveg">Sold out</span>
      </div>
    </div>
  )
}
