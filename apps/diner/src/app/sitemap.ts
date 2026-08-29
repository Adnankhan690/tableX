import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * One entry, because there is exactly one public page.
 *
 * The merged branch listed `/r/coastal-curry` here. That is a LOCAL SEED restaurant which does
 * not exist on production, so it would have submitted a 404 to Google on a site whose whole
 * argument is reliability — and every `/r/{slug}` is noindexed anyway, so even a real one would
 * have been a contradiction: a sitemap says "please index this" and the page says "do not".
 *
 * Enumerating restaurants from the API was considered and rejected for the same reason, plus a
 * second: it would couple a static page to a free-tier service whose cold start is measured in
 * tens of seconds.
 *
 * `monthly` rather than `daily`. changeFrequency is a hint, and a landing page that claims daily
 * change and then does not change teaches the crawler to discount the hint.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: 'monthly', priority: 1 }]
}
