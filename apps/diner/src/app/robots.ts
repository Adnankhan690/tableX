import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * Lives at `app/`, not inside a route group: metadata routes resolve from the app directory
 * root, and burying this in `(marketing)` would put its resolution on an undocumented path for
 * the sake of tidiness.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    /**
     * `/t/{token}` MINTS a guest session on load, so the harm there is the FETCH itself, not the
     * indexing — that is the one path that must never be crawled at all.
     *
     * Every other diner route is handled by the noindex meta from `(app)/layout.tsx`, and that
     * is deliberate rather than an oversight: a crawler can only read a noindex tag if it is
     * allowed to fetch the page, so Disallow + noindex on the same URL cancel out and leave it
     * indexed as a bare URL with no title. Disallow prevents fetching; noindex prevents
     * indexing; they are not interchangeable.
     *
     * Do NOT add `/_next/` — Google must fetch the CSS and JS to render the landing page.
     */
    rules: { userAgent: '*', disallow: ['/t/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
