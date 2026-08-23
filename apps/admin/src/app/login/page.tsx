import { LoginForm } from '@/components/login-form'

/** No AppShell: the user is not authenticated yet, so there is no chrome to show. */
export default function Page() {
  return <LoginForm />
}
