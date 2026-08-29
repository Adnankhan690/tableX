import type { Metadata } from 'next'
import { CheckoutScreen } from '@/components/checkout-screen'
import { SessionGate } from '@/components/session-gate'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <SessionGate>
      <CheckoutScreen />
    </SessionGate>
  )
}
