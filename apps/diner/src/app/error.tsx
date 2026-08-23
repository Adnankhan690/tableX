'use client'

import { CenteredMessage, PrimaryButton } from '@/components/screen'

/**
 * The last-resort boundary. `reset` re-renders the failed segment, which recovers from a
 * transient fetch failure -- the overwhelmingly likely cause on restaurant wifi -- without
 * making the diner start over from the QR code.
 *
 * The error message itself is not shown. It is a React or bundler message that means nothing
 * to a diner, and the useful detail is already in the request id on any API failure.
 *
 * The name shadows the global Error, and stays that way: Next requires this to be the default
 * export of error.tsx and names it Error by convention. Renaming the function would not remove
 * the shadowing anyway, since the file still exports a component in the Error position.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next names this export Error by convention
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <CenteredMessage
      title="Something went wrong"
      body="This is usually a connection problem. Try again, or ask a staff member for help."
      action={<PrimaryButton onClick={reset}>Try again</PrimaryButton>}
    />
  )
}
