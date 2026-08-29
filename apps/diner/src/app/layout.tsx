import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tabley.in'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Tabley — Smart QR Dine-In Ordering & Digital Menus for Restaurants',
    template: '%s | Tabley',
  },
  description:
    'Instant QR code table ordering, interactive digital menus with dish photos, live kitchen tracking, and contactless payments. Fast, modern, and zero app downloads required.',
  keywords: [
    'QR code restaurant ordering',
    'digital dining menu',
    'table ordering system',
    'restaurant QR menu',
    'dine in ordering app',
    'smart menu for restaurants',
    'contactless dining',
    'Tabley',
    'restaurant ordering platform',
  ],
  authors: [{ name: 'Tabley Team', url: siteUrl }],
  creator: 'Tabley',
  publisher: 'Tabley',
  applicationName: 'Tabley',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'Tabley — Smart QR Dine-In Ordering & Digital Menus for Restaurants',
    description:
      'Instant QR code table ordering, interactive digital menus with dish photos, live kitchen tracking, and contactless payments. Fast, modern, zero app downloads.',
    url: siteUrl,
    siteName: 'Tabley',
    images: [
      {
        url: '/icon.svg',
        width: 512,
        height: 512,
        alt: 'Tabley — Smart QR Dine-In Ordering & Digital Menus',
      },
    ],
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tabley — Smart QR Dine-In Ordering & Digital Menus',
    description:
      'Instant QR code table ordering, digital menus with dish photos, live kitchen tracking, and contactless payments.',
    creator: '@hellotabley',
    images: ['/icon.svg'],
  },
  category: 'restaurant & dining technology',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#fffcf8',
}

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: 'Tabley',
      description: 'Smart QR Dine-In Ordering & Digital Menus for Restaurants',
      inLanguage: 'en-IN',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#software`,
      name: 'Tabley',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'All',
      url: siteUrl,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'INR',
      },
      description:
        'Instant QR code table ordering, interactive digital menus, and contactless payments for modern restaurants.',
    },
    {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: 'Tabley',
      url: siteUrl,
      logo: `${siteUrl}/icon.svg`,
      sameAs: ['https://twitter.com/hellotabley', 'https://instagram.com/hellotabley'],
    },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <div className="mx-auto min-h-dvh w-full max-w-phone bg-bg">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  )
}
