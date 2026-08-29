import { QrGlyph, StarGlyph, VegMark } from '../glyphs'
import { Container, SectionHeader } from '../shell'
import { StatusRail } from '../status-rail'

/**
 * Three steps, in the order they actually happen. The visual above each is drawn from the real
 * thing that step produces — a code, a menu row, a status rail — rather than a generic icon, so
 * the column reads as a sequence of screens rather than a feature list.
 */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-h" id="how-it-works" className="py-16 md:py-24 lg:py-32">
      <Container>
        <SectionHeader
          id="how-h"
          eyebrow="How it works"
          title="Three things happen, in this order."
          lead="No hardware to buy, no POS to integrate with, and nothing for the diner to download."
        />

        <div className="mt-10 grid grid-cols-1 divide-y divide-line lg:mt-14 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <Step index="01" title="They scan." visual={<QrGlyph size={48} className="text-ink" />}>
            Each table gets its own code. It carries an opaque, rotatable token rather than a table
            number, so nobody can edit a URL onto the next table&rsquo;s tab — and a sticker
            photographed and posted online is invalidated by regenerating one row.
          </Step>

          <Step index="02" title="They order." visual={<MiniMenu />} className="lg:px-8">
            Your whole menu in a single load: your categories, veg, non-veg and egg marked the way
            Indian diners already read them, prep times, and the dishes diners rate highest lifted
            to the top without re-sorting the arrangement you chose. A dish you have run out of
            stays on the page, greyed and labelled — a dish that silently disappears reads as a
            broken website.
          </Step>

          <Step
            index="03"
            title="You cook. They watch."
            visual={<StatusRail className="w-full max-w-[220px]" />}
            className="lg:pl-8"
          >
            &ldquo;Order received&rdquo;, &ldquo;Confirmed by the kitchen&rdquo;, &ldquo;Being
            prepared&rdquo;, &ldquo;Ready&rdquo;, &ldquo;Served&rdquo;. The diner watches it move
            instead of walking to the counter to ask.
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
