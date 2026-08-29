import type { Metadata } from 'next'
import { OrderList } from '@/components/order-list'
import { SessionGate } from '@/components/session-gate'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <SessionGate>
      <OrderList />
    </SessionGate>
  )
}
