import { OnboardForm } from '@/components/onboard-form'

/**
 * No AppShell, by the same logic as /login: the shell shows a restaurant's name and its five
 * tenant screens, and the caller of this page has no restaurant yet -- creating one is the
 * point (docs/DECISIONS.md D14).
 *
 * Not linked from anywhere in the app either. The operator who runs the deployment is the only
 * caller, they hold the platform token, and putting a "create a restaurant" link on the staff
 * login screen would be noise for the several hundred people who sign in there to run a floor.
 * The URL is in the README.
 */
export default function Page() {
  return <OnboardForm />
}
