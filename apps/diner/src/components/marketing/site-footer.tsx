// NOTE: do NOT link `/qr` from here. That page renders the PUBLIC restaurant directory -- every
// restaurant on the platform, with a QR into each -- so from a page addressed to strangers it
// publishes the customer list. Demo links must be scoped to the demo restaurant's own slug.
import { ADMIN_BASE_URL, DEMO_MENU_HREF } from '@/lib/site'
import { PlateMark } from './glyphs'
import { Container } from './shell'

/**
 * The footer, on the same ink ground as the reliability band so the page is bookended rather
 * than fading out.
 *
 * NO Privacy or Terms column, no app-store badges, no newsletter box, no social row. None of
 * those exist, and a dead footer link is the exact opposite of the impression this page is built
 * to make. Privacy and Terms are a real gap for a payments-adjacent product and are flagged to
 * the owner rather than stubbed out here.
 *
 * "Your table" → /menu is a permanent, crawler-invisible-free second satisfaction of the
 * return-to-table affordance: the fixed bar is dismissible and client-rendered, so this is the
 * path that always exists.
 */
export function SiteFooter() {
  return (
    <footer className="mk-dark border-t border-[var(--mk-rule-dark)] bg-ink py-14 lg:py-20">
      <Container>
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-12">
          <div className="col-span-2 lg:col-span-4">
            <div className="flex items-center gap-2">
              <PlateMark size={22} />
              <span className="font-display text-[1.35rem] font-semibold tracking-[-0.015em] text-bg">
                tabley
              </span>
            </div>
            <p className="mt-3 max-w-[36ch] text-[0.9375rem] text-[var(--mk-text-dark)]">
              QR table ordering for Indian restaurants.
            </p>
            <p className="mt-2 text-[0.8125rem] text-line">Prices in ₹. No diner login required.</p>
          </div>

          <FooterColumn
            heading="Product"
            links={[
              { href: '#how-it-works', label: 'How it works' },
              { href: '#the-menu', label: 'The menu' },
              { href: '#reliability', label: 'Reliability' },
              { href: '#payments', label: 'Payments' },
              { href: '#faq', label: 'FAQ' },
            ]}
          />

          <FooterColumn
            heading="Try it"
            links={[
              ...(DEMO_MENU_HREF
                ? [{ href: DEMO_MENU_HREF, label: 'See a live menu', nofollow: true }]
                : []),
              { href: '/menu', label: 'Your table', nofollow: true },
            ]}
          />

          <FooterColumn
            heading="For restaurants"
            links={[
              { href: '#get-set-up', label: 'Get set up' },
              { href: ADMIN_BASE_URL, label: 'Staff sign in' },
            ]}
          />
        </div>

        <div className="mt-12 border-t border-[var(--mk-rule-dark)] pt-6 text-[0.8125rem] tabular-nums text-line">
          © 2026 tabley · Made for Indian restaurants.
        </div>
      </Container>
    </footer>
  )
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string
  links: ReadonlyArray<{ href: string; label: string; nofollow?: boolean }>
}) {
  return (
    <div className="lg:col-span-2">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-bg">
        {heading}
      </h2>
      <ul className="mt-3 space-y-2.5">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <a
              href={link.href}
              rel={link.nofollow ? 'nofollow' : undefined}
              className="inline-flex min-h-tap items-center text-[0.9375rem] text-[var(--mk-text-dark)] transition-colors hover:text-bg"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
