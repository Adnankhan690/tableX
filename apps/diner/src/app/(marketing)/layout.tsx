import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import './marketing.css'

const TITLE = 'tabley — QR table ordering for Indian restaurants'
const DESCRIPTION =
  'Diners scan the code on their table, browse your menu and pay by UPI or at the counter. No app, no login. Your kitchen gets a live board.'

/**
 * The public marketing page: the only indexable route in this app.
 *
 * Three things separate it from `(app)`, and all three are why the route group exists at all.
 * It opts back IN to indexing (the root layout defaults to noindex for the QR flow), it is
 * full-width rather than capped at `max-w-phone`, and it mounts no <Providers> — a stranger
 * reading a landing page has no cart and no table session, and pulling that context in would put
 * the cart reducer in the bundle of the page most likely to be someone's first impression.
 */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  // The deliberate opt-out from the root layout's fail-safe noindex. Leaf-most wins.
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'tabley',
    locale: 'en_IN',
    title: TITLE,
    description:
      'The code on the table is the whole ordering counter. Diners scan, order and pay from their own phone with nothing installed — and the kitchen gets a live board instead of a shouted ticket.',
  },
  twitter: { card: 'summary_large_image' },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="tx-mk min-h-dvh bg-bg">{children}</div>
}
