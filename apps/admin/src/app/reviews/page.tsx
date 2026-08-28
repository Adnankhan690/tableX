import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { ReviewsFeed } from '@/components/reviews-feed'

/**
 * Suspense is required, not decorative: ReviewsFeed reads `menu_item_uid` from the query string
 * via useSearchParams, and Next refuses to prerender a client component that does so without a
 * boundary. Without this the page builds to an error rather than to a page.
 */
export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ReviewsFeed />
      </Suspense>
    </AppShell>
  )
}
