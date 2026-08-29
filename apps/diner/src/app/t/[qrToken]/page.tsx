import type { Metadata } from 'next'
import { ScanHandler } from '@/components/scan-handler'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * The QR landing (PRD 6.1).
 *
 * In Next 15 `params` is a Promise and must be awaited in a server component. Awaiting here
 * keeps the client component below free of that concern.
 */
export default async function Page({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params
  return <ScanHandler qrToken={qrToken} />
}

