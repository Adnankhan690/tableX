import { BoardMock } from '../board-mock'
import { BoardGlyph, ScoresGlyph, SwitchGlyph } from '../glyphs'
import { Container, SectionHeader } from '../shell'

const LINES = [
  {
    Glyph: BoardGlyph,
    title: 'Accept, prepare, ready, served.',
    body: 'Every transition checked server-side, with a reason required on a reject or a cancel — and the diner sees the reason.',
  },
  {
    Glyph: SwitchGlyph,
    title: 'Accepting orders is one switch.',
    body: 'Turn the floor off at the end of service without editing the menu. The menu stays readable; the Add buttons go, and the diner is told at the top rather than at checkout.',
  },
  {
    Glyph: ScoresGlyph,
    title: 'Ratings that name a shift.',
    body: 'Food and service reported separately, never blended. “Food 4.6, service 3.2” names two different fixes; “3.9” names none.',
  },
] as const

export function YourFloor() {
  return (
    <section
      aria-labelledby="floor-h"
      className="border-t border-line bg-surface-sunken py-16 md:py-24 lg:py-32"
    >
      <Container>
        <SectionHeader
          id="floor-h"
          eyebrow="For your staff"
          title="Your floor, on one screen."
          lead="Staff open one board at the start of a shift and leave it open. New orders arrive with the table, the items, the total and how the diner is paying — and announce themselves with a sound."
        />

        {/* Below md the board becomes a horizontal strip using the app's own .scroll-x utility
            rather than a second layout: three tickets side by side do not fit a phone, and
            reinventing the scroll container here would mean two definitions of one behaviour. */}
        <div className="scroll-x mt-10 -mx-5 flex gap-4 px-5 md:hidden">
          {/* One ticket per card at a fixed width, so the strip has an obvious "there is more". */}
          <BoardMock variant="light" className="w-[260px] shrink-0" />
        </div>
        <BoardMock variant="light" className="mx-auto mt-10 hidden max-w-[900px] md:block" />

        <p className="mt-4 text-center text-[0.8125rem] italic text-muted">
          The admin order board. It runs as a separate app at admin.tabley.in.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {LINES.map(({ Glyph, title, body }, i) => (
            <div key={title} className="mk-reveal" style={{ animationDelay: `${i * 60}ms` }}>
              <Glyph size={24} className="text-accent" />
              <h3 className="mt-3 text-[1.125rem] font-semibold leading-[1.3] text-ink">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-[1.62] text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
