import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Order',
  description: 'Scan, order and track your food from your table.',
  // A diner arrives from a QR code, so there is nothing to index and a crawler following the
  // link would create guest sessions.
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
      <body className="min-h-dvh bg-bg text-ink antialiased">
        {/* max-w-phone keeps a phone layout phone-shaped if it is opened on a laptop, without
            pretending to be a desktop design (PRD 7). */}
        <div className="mx-auto min-h-dvh w-full max-w-phone bg-bg">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  )
}
