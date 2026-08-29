import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * Lives at `app/`, not inside a route group: metadata routes resolve from the app directory
 * root, and burying this in `(marketing)` would put its resolution on an undocumented path for
 * the sake of tidiness.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/r/'],
      /**
       * `/t/{token}` is the one that MATTERS. It mints a guest session on load, so the harm
       * there is the FETCH itself rather than the indexing — no meta tag can prevent it, because
       * the crawler has to fetch the page to read the tag. It must never be crawled at all.
       *
       * The four session-gated routes below are a lesser case: they are already noindexed by
       * `(app)/layout.tsx`, and they are disallowed here only to keep crawlers off a free-tier
       * backend for pages that render an empty state to anyone without a table session.
       *
       * `/r/` is deliberately ALLOWED. It is noindexed rather than disallowed, and that is the
       * distinction worth remembering: a crawler can only read a noindex tag if it is allowed to
       * fetch the page, so Disallow + noindex on the same URL cancel out and leave it listed as
       * a bare URL with no title. Disallow prevents fetching; noindex prevents indexing. They
       * are not interchangeable, and stacking them is worse than either alone.
       *
       * Do NOT add `/_next/` — Google must fetch the CSS and JS to render the landing page.
       */
      disallow: ['/t/', '/menu', '/cart', '/checkout', '/orders/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
