import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/auth-provider'
import './globals.css'

/**
 * One webfont, self-hosted at build time by next/font -- no network request at runtime, no
 * layout shift, and no new dependency (next/font ships with Next).
 *
 * The diner app deliberately uses system faces because PRD 7 makes its payload a product
 * requirement. That reasoning does not reach here: this panel is authenticated, opened once at
 * the start of a shift and then held open, so a ~30KB subset buys a typeface that can carry a
 * dense board -- and Inter's tabular figures are what stop a column of live totals jittering as
 * the numerals change.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-admin-sans',
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
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
