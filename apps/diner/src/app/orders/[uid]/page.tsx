import { OrderTracking } from '@/components/order-tracking'
import { SessionGate } from '@/components/session-gate'

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  // In Next 15 `params` is a Promise and must be awaited in a server component.
  const { uid } = await params

  return (
    <SessionGate>
      <OrderTracking orderUid={uid} />
    </SessionGate>
  )
}
