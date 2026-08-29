import type { Metadata } from 'next'
import { Providers } from '@/components/providers'

/**
 * The diner app proper: everything reached from a QR code.
 *
 * This layout exists because `/` became a public marketing page (docs/DECISIONS.md D19), and
 * the three things the old root layout did for the diner flow — the phone column, the cart and
 * session context, and the noindex — are all actively wrong for a page that has to rank on a
 * desktop search result. Route groups do not appear in URLs, so `/menu` is still `/menu` and
 * every printed QR code still resolves.
 */
export const metadata: Metadata = {
  title: 'Order',
  description: 'Scan, order and track your food from your table.',
  // A diner arrives from a QR code, so there is nothing to index and a crawler following the
  // link would create guest sessions. The root layout also defaults to noindex; this is stated
  // again here so moving this group can never silently lose it.
  robots: { index: false, follow: false },
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // max-w-phone keeps a phone layout phone-shaped if it is opened on a laptop, without
    // pretending to be a desktop design (PRD 7).
    <div className="mx-auto min-h-dvh w-full max-w-phone bg-bg">
      <Providers>{children}</Providers>
    </div>
  )
}
