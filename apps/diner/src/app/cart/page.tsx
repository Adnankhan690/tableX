import { CartScreen } from '@/components/cart-screen'
import { SessionGate } from '@/components/session-gate'

export default function Page() {
  return (
    <SessionGate>
      <CartScreen />
    </SessionGate>
  )
}
