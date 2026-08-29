import type { Metadata } from 'next'
import { CartScreen } from '@/components/cart-screen'
import { SessionGate } from '@/components/session-gate'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <SessionGate>
      <CartScreen />
    </SessionGate>
  )
}
