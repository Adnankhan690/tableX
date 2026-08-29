import type { Metadata } from 'next'
import { MenuScreen } from '@/components/menu-screen'
import { SessionGate } from '@/components/session-gate'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <SessionGate>
      <MenuScreen />
    </SessionGate>
  )
}

