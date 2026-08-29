import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tabley.in'

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/r/'],
        disallow: ['/t/', '/cart', '/checkout', '/orders/', '/menu'],
      },
      {
        userAgent: 'Googlebot',
        allow: ['/', '/r/'],
        disallow: ['/t/', '/cart', '/checkout', '/orders/', '/menu'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
