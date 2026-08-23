import { AppShell } from '@/components/app-shell'
import { OrderDetail } from '@/components/order-detail'

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  // In Next 15 `params` is a Promise and must be awaited in a server component.
  const { uid } = await params
  return (
    <AppShell>
      <OrderDetail orderUid={uid} />
    </AppShell>
  )
}
