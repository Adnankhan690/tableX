import { OrderList } from '@/components/order-list'
import { SessionGate } from '@/components/session-gate'

export default function Page() {
  return (
    <SessionGate>
      <OrderList />
    </SessionGate>
  )
}
