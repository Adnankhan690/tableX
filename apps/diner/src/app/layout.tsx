import type { Metadata, Viewport } from 'next'
import { SITE_URL } from '@/lib/site'
import './globals.css'

/**
 * The root layout now carries <html>, <body> and the stylesheet, and nothing else.
 *
 * Everything that used to live here — the phone column, <Providers>, the noindex — belonged to
 * the diner flow specifically, and moved into `(app)/layout.tsx` when `/` became a public
 * marketing page (docs/DECISIONS.md D19).
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  /**
   * A plain string, deliberately NOT a `{ default, template }` pair. A title template would
   * rewrite every diner tab from "Order" to "Order · tabley", which is a worse label on the one
   * screen a diner keeps open through a meal.
   */
  title: 'tabley',
  /**
   * noindex is the FAIL-SAFE DEFAULT, not a statement about this app's content. Nine of the ten
   * routes here are reached from a QR code and must never be crawled — `/t/{token}` mints a
   * guest session merely by being fetched. `(marketing)/layout.tsx` is the single deliberate
   * opt-out; a new route inherits the safe answer unless someone chooses otherwise.
   */
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * Zoom is deliberately NOT blocked.
   *
   * `maximumScale: 1` is the reflexive setting for an app-like mobile page and it is an
   * accessibility failure here: a menu is dense text read in dim light, and a diner who needs
   * to pinch a dish description larger must be able to. 5 is generous enough to be useful.
   */
  maximumScale: 5,
  userScalable: true,
  // One value, not a light/dark pair: the menu is light-only (see globals.css), so offering the
  // browser a dark chrome colour would tint the address bar to a theme the page never renders.
  themeColor: '#fffcf8',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-ink antialiased">{children}</body>
    </html>
  )
}
