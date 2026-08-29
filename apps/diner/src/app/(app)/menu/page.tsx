import { MenuScreen } from '@/components/menu-screen'
import { SessionGate } from '@/components/session-gate'

export default function Page() {
  return (
    <SessionGate>
      <MenuScreen />
    </SessionGate>
  )
}
