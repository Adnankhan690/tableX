'use client'

import { isApiError } from '@tablex/api-client'
import { Spinner } from '@tablex/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'

export function LoginForm() {
  const router = useRouter()
  const { login, auth, hydrated } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A signed-in user landing here is sent onward. In an effect, not during render, because Next
  // forbids navigating while rendering.
  useEffect(() => {
    if (hydrated && auth !== null) router.replace('/orders')
  }, [hydrated, auth, router])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError(null)

    login(email.trim(), password)
      .then(() => router.replace('/orders'))
      .catch((err: unknown) => {
        setSubmitting(false)
        /**
         * The server's message is shown verbatim and NOT elaborated on.
         *
         * It deliberately returns one identical message for an unknown email and a wrong
         * password, so that staff addresses at a restaurant cannot be enumerated. Adding
         * client-side specificity -- "no account with that email" -- would hand back exactly
         * the distinction the backend went out of its way to hide.
         */
        setError(isApiError(err) ? err.message : 'Could not sign in. Check your connection.')
      })
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-card"
      >
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Manage your restaurant&apos;s orders and menu.</p>

        <label className="mt-5 block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        {error !== null ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 flex min-h-tap w-full items-center justify-center gap-2 rounded-card bg-accent text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Spinner /> Signing in
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </main>
  )
}
