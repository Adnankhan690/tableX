import type { Metadata } from 'next'
import { RestaurantLanding } from '@/components/restaurant-landing'

/**
 * The restaurant-level fallback QR (docs/DECISIONS.md D4).
 *
 * Exists because table QR stickers get peeled off, spilled on and swapped between tables. One
 * code taped to the counter keeps the restaurant taking orders on a bad night.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const formattedName = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return {
    title: `${formattedName} — Dine-In Menu & QR Table Ordering`,
    description: `Explore the digital menu, photos, and order directly from your table at ${formattedName} with Tabley. Zero app downloads.`,
    alternates: {
      canonical: `/r/${slug}`,
    },
    openGraph: {
      title: `${formattedName} — Dine-In Menu & QR Table Ordering`,
      description: `Explore the digital menu, dish photos, and order from your table at ${formattedName}.`,
      url: `/r/${slug}`,
    },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <RestaurantLanding slug={slug} />
}

