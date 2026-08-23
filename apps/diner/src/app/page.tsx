import Link from 'next/link'
import { RootLanding } from '@/components/root-landing'

/**
 * The bare root route.
 *
 * Nobody should arrive here: diners enter through /t/{token} from the QR code on their table.
 * Someone who does has either typed the domain or lost their way, so this explains the one
 * thing they need to do -- and offers a route back to the menu if a session is already stored,
 * which is the common case for a diner who hit "home" mid-meal.
 */
export default function Page() {
  return <RootLanding fallback={<Link href="/menu">Back to the menu</Link>} />
}
