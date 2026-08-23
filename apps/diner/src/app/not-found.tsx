import { CenteredMessage } from '@/components/screen'

/**
 * Diner-appropriate copy: it names the recovery action rather than the HTTP status. A diner
 * holding a phone at a table can act on "scan the QR code again"; they cannot act on "404".
 */
export default function NotFound() {
  return (
    <CenteredMessage
      title="Page not found"
      body="Scan the QR code on your table again, or ask a staff member for help."
    />
  )
}
