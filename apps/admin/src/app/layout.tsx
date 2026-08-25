import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/components/auth-provider'
import './globals.css'

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
  themeColor: '#f8fafc',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
