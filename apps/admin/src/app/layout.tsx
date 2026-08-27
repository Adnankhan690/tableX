import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { AuthProvider } from '@/components/auth-provider'
import './globals.css'

/**
 * Two webfonts, both self-hosted at build time by next/font -- no runtime request to Google, no
 * layout shift (next/font emits a size-adjusted local fallback from its own capsize metrics), and
 * no new dependency, since next/font ships with Next.
 *
 * The diner app deliberately uses system faces because PRD 7 makes its payload a product
 * requirement. That reasoning does not reach here: this panel is authenticated, opened once at the
 * start of a shift and then held open, so two ~30KB subsets are paid for once and buy a typeface
 * that can carry a dense board.
 *
 * Why a matched sans/mono PAIR rather than one face, which is the part that actually matters:
 * this board is mostly figures -- order numbers called across a kitchen, an age clock ticking once
 * a second, live totals, counts in the stats strip. Geist and Geist Mono are metrically identical
 * (same 1000 upm, x-height 530, cap 710, ascent 1005, descent -295), so a mono figure can sit in
 * the same line as sans text without shifting the baseline or growing the line box. That is what
 * lets `.figures` in globals.css exist as a utility instead of a per-component layout fight.
 * Inter, which this replaced, has no metric-matched mono -- and Inter was not broken, it just had
 * to carry both jobs alone.
 */
const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-admin-sans',
  display: 'swap',
})

/**
 * Preloaded like the sans, not lazily: the order number on every card on the board is mono, so
 * this face is needed on the very first paint, not on some later interaction.
 */
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-admin-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'tableX Admin',
  description: 'Manage incoming orders, the menu and table QR codes.',
  // Nothing here should ever be indexed.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // One value, not a light/dark pair: the panel is light-only (see globals.css), so offering the
  // browser a dark chrome colour would tint the address bar to a theme the page never renders.
  themeColor: '#f6f7f9',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
