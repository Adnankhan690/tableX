import { ReturnToTable } from '@/components/marketing/return-to-table'
import { CapabilityStrip } from '@/components/marketing/sections/capability-strip'
import { Faq } from '@/components/marketing/sections/faq'
import { FinalCta } from '@/components/marketing/sections/final-cta'
import { Hero } from '@/components/marketing/sections/hero'
import { HowItWorks } from '@/components/marketing/sections/how-it-works'
import { LiveDemo } from '@/components/marketing/sections/live-demo'
import { Payments } from '@/components/marketing/sections/payments'
import { Reliability } from '@/components/marketing/sections/reliability'
import { TheMenu } from '@/components/marketing/sections/the-menu'
import { YourFloor } from '@/components/marketing/sections/your-floor'
import { SiteFooter } from '@/components/marketing/site-footer'
import { SiteHeader } from '@/components/marketing/site-header'
import { SITE_URL } from '@/lib/site'

/**
 * tabley.in.
 *
 * A server component that fetches nothing — it must build as `○ (Static)` in the route table.
 * A landing page that makes a network call inherits the backend's cold start as its own
 * time-to-first-byte, which on a free tier is measured in tens of seconds.
 *
 * The section order is an argument, not a list: what it is (hero), what that means concretely
 * (capabilities), how it works, the screen it lives or dies on, then the audience switches to the
 * owner for reliability, payments and the floor, and finally the objections and the ask.
 */

/**
 * Organization and WebSite only.
 *
 * NO aggregateRating, NO Review, NO offers. Structured data is the one place where invented proof
 * is machine-readable, which is exactly the version search engines penalise — and there is no
 * rating, review or price in this repo to put there honestly.
 */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'tabley',
      url: SITE_URL,
      description: 'QR table ordering for Indian restaurants.',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'tabley',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      description:
        'Diners scan the code on their table, browse your menu and pay by UPI or at the counter. No app, no login.',
      inLanguage: 'en-IN',
    },
  ],
}

export default function Page() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-surface focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <CapabilityStrip />
        <HowItWorks />
        <TheMenu />
        <Reliability />
        <Payments />
        <YourFloor />
        <LiveDemo />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      {/* Outside <main>: it is chrome for a returning diner, not part of the page's argument. */}
      <ReturnToTable />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has no other injection point, and the payload is a module-level literal with no user input in it
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </>
  )
}
