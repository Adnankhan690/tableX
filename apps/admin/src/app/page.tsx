import { redirect } from 'next/navigation'

/** The order board is the app; the root is just a signpost to it. */
export default function Page() {
  redirect('/orders')
}
