import { CheckoutScreen } from '@/components/checkout-screen'
import { SessionGate } from '@/components/session-gate'

export default function Page() {
  return (
    <SessionGate>
      <CheckoutScreen />
    </SessionGate>
  )
}
