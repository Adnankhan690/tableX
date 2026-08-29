import { VegMark } from '../glyphs'
import { PhoneMock } from '../phone-mock'
import { Container, SectionHeader } from '../shell'

/**
 * The credibility section: the menu screen, annotated.
 *
 * Three layouts, because a callout ring around a phone is a desktop composition that does not
 * survive a narrow column. Below 640px the callouts stack under the phone with no leader lines
 * at all — a leader line to an element two screens away is a scribble. The lines exist only at
 * ≥1024px, where the callouts actually flank the thing they point at.
 */

const LEFT = [
  {
    title: 'Veg and non-veg marks',
    body: 'The packaging symbol, not the word. It reads without being read, and it carries an accessible name so colour is never the only signal.',
  },
  {
    title: 'Most loved',
    body: 'The three highest-rated dishes, only if they clear a real floor. Never a re-sort of your menu.',
  },
] as const

const RIGHT = [
  {
    title: 'Sold out, in place',
    body: 'Greyed and labelled where the dish has always been.',
  },
  {
    title: 'Search and veg filter',
    body: 'Instant, because the whole menu is already on the phone.',
  },
  {
    title: 'The cart bar',
    body: 'Appears only once there is something in it.',
  },
] as const

const ALL = [...LEFT, ...RIGHT]

export function TheMenu() {
  return (
    <section
      aria-labelledby="menu-h"
      id="the-menu"
      className="border-t border-line bg-surface-sunken py-16 md:py-24 lg:py-32"
    >
      <Container>
        <SectionHeader
          id="menu-h"
          eyebrow="The menu"
          title="The menu is the product."
          lead="It is the one screen a diner spends the whole meal on, which is why it has the least on it."
          className="text-center lg:text-left [&>h2]:mx-auto [&>h2]:lg:mx-0 [&>p]:mx-auto [&>p]:lg:mx-0"
        />

        {/* < 1024px: the phone, then the callouts. No leader lines. */}
        <div className="mt-10 lg:hidden">
          <PhoneMock className="mx-auto w-[280px] sm:w-[300px]" />
          <ul className="mt-10 space-y-5 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:gap-y-6 sm:space-y-0">
            {ALL.map((item) => (
              <li key={item.title} className="flex gap-3">
                <VegMark size={14} className="mt-1 text-accent" tone="veg" />
                <div>
                  <h3 className="text-[1.125rem] font-semibold leading-[1.3] text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-[0.8125rem] leading-[1.5] text-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ≥ 1024px: the callouts flank the phone, and only here do leader lines make sense. */}
        <div className="relative mt-14 hidden grid-cols-12 items-center gap-8 lg:grid">
          <LeaderLines />
          <ul className="col-span-3 space-y-10 text-right">
            {LEFT.map((item) => (
              <Callout key={item.title} {...item} />
            ))}
          </ul>
          <PhoneMock className="col-span-6 mx-auto w-[340px]" />
          <ul className="col-span-3 space-y-8">
            {RIGHT.map((item) => (
              <Callout key={item.title} {...item} />
            ))}
          </ul>
        </div>
      </Container>
    </section>
  )
}

function Callout({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <h3 className="text-[1.125rem] font-semibold leading-[1.3] text-ink">{title}</h3>
      <p className="mt-1.5 text-[0.8125rem] leading-[1.5] text-muted">{body}</p>
    </li>
  )
}

/**
 * One SVG overlay for all five leader lines.
 *
 * Drawn as percentage-space polylines rather than as five absolutely positioned divs, so they
 * scale with the grid instead of needing a magic number per breakpoint. Each runs horizontally
 * from the callout's inner edge, bends once, and ends on a dot at the phone's edge.
 */
function LeaderLines() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <g stroke="var(--tx-line)" strokeWidth="0.15" fill="none" vectorEffect="non-scaling-stroke">
        <path d="M24 20 L31 20 L31 30" />
        <path d="M24 62 L31 62 L31 52" />
        <path d="M76 16 L69 16 L69 26" />
        <path d="M76 46 L69 46 L69 42" />
        <path d="M76 76 L69 76 L69 70" />
      </g>
      <g fill="var(--tx-line)">
        <circle cx="31" cy="30" r="0.5" />
        <circle cx="31" cy="52" r="0.5" />
        <circle cx="69" cy="26" r="0.5" />
        <circle cx="69" cy="42" r="0.5" />
        <circle cx="69" cy="70" r="0.5" />
      </g>
    </svg>
  )
}
