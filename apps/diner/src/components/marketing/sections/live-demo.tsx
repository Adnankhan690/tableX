import { DEMO_MENU_HREF } from '@/lib/site'
import { ArrowRight, MenuGlyph } from '../glyphs'
import { Container, SectionHeader } from '../shell'

/**
 * The demo section, which does not exist unless a demo restaurant does.
 *
 * `NEXT_PUBLIC_DEMO_RESTAURANT_SLUG` gates the whole section rather than defaulting to a
 * hardcoded slug, because both ways of getting it wrong are bad in public: a slug that does not
 * resolve sends a prospect to a 404 from a page whose entire argument is reliability, and a
 * paying tenant's slug walks strangers into a live menu and mints guest sessions on their tables.
 *
 * NEVER SHIP A DEAD QR OR A LINK TO A 404 ON A QR PRODUCT'S LANDING PAGE. Unset is the correct
 * state until a restaurant onboarded *as a demo* exists on production with a filled-in menu.
 * `backend/seeds/demo_restaurant.sql` creates exactly that.
 *
 * IT LINKS ONE PLACE, AND THAT IS NOT AN OVERSIGHT. An earlier version also linked `/qr`, the
 * diner app's code gallery. That page calls the PUBLIC restaurant directory and renders a card
 * for every restaurant on the platform -- so linking it from a page addressed to strangers would
 * publish the customer list, next to an invitation to scan into their tables. Anything added here
 * must be scoped to the demo restaurant's own slug.
 */
export function LiveDemo() {
  if (!DEMO_MENU_HREF) return null

  return (
    <section aria-labelledby="demo-h" className="border-t border-line py-16 md:py-24 lg:py-32">
      <Container>
        <SectionHeader
          id="demo-h"
          eyebrow="Try it"
          title="See it before you say yes."
          lead="The fastest way to understand tableX is to be the diner. Open the demo menu on your phone and order something."
        />

        <div className="mt-10 max-w-[520px]">
          <DemoCard
            href={DEMO_MENU_HREF}
            Glyph={MenuGlyph}
            title="Open the demo menu"
            body="The real diner flow, on a real restaurant record: browse, add to the cart, place an order and watch it move."
          />
        </div>
      </Container>
    </section>
  )
}

function DemoCard({
  href,
  Glyph,
  title,
  body,
}: {
  href: string
  Glyph: (props: { size?: number; className?: string }) => React.JSX.Element
  title: string
  body: string
}) {
  return (
    <a
      href={href}
      rel="nofollow"
      className="mk-lift group flex flex-col rounded-card border border-line bg-surface p-6"
    >
      <Glyph size={24} className="text-accent" />
      <h3 className="mt-3 flex items-center gap-1.5 text-[1.125rem] font-semibold leading-[1.3] text-ink">
        {title}
        <ArrowRight
          size={16}
          className="transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </h3>
      <p className="mt-2 text-[0.9375rem] leading-[1.62] text-muted">{body}</p>
    </a>
  )
}
