import { RestaurantLanding } from '@/components/restaurant-landing'

/**
 * The restaurant-level fallback QR (docs/DECISIONS.md D4).
 *
 * Exists because table QR stickers get peeled off, spilled on and swapped between tables. One
 * code taped to the counter keeps the restaurant taking orders on a bad night.
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <RestaurantLanding slug={slug} />
}
