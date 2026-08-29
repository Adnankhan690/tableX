// MUST stay directly in app/ — Next's isRootNotFound() regex only matches app/not-found.<ext>;
// inside a route group this silently stops being the global 404 and becomes that group's 404,
// leaving unmatched URLs on Next's own default page.
import Link from 'next/link'
import { CenteredMessage } from '@/components/screen'

/**
 * The global 404, for both route groups at once.
 *
 * That is why the copy no longer says "scan the QR code on your table": this file is now also
 * what a stranger who mistyped a URL on the public site sees, and telling them to look for a
 * table is nonsense. It names both recovery paths instead. It renders under the bare root
 * layout, so it supplies its own phone column.
 */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-phone">
      <CenteredMessage
        title="Page not found"
        body="If you are at a table, scan the QR code on it again or ask a staff member for help."
        action={
          <Link href="/" className="text-[0.9375rem] font-medium text-accent underline">
            Go to the home page
          </Link>
        }
      />
    </div>
  )
}
