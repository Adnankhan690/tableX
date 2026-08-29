import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * One entry, because there is exactly one public page.
 *
 * Enumerating restaurants from the API was considered and rejected twice over: it would couple a
 * static page to a free-tier service with a cold start measured in tens of seconds, and every
 * `/r/{slug}` is noindexed anyway, so the crawl budget would buy nothing.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: 'monthly', priority: 1 }]
}
