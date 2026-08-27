'use client'

import { isApiError } from '@tablex/api-client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { Button, Field, Input, Notice, PasswordInput } from '@/components/ui'

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
    /*
      The product's first impression, and it used to be an unbranded 384px card on empty canvas.
      Two panes on a laptop: the identity and what this panel is for on the left, the form on the
      right. Below lg it collapses to the form with the wordmark above it -- a staff member signing
      in on a tablet at the counter does not need the pitch.
    */
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink px-10 py-12 text-white lg:flex">
        {/* One soft accent wash, drawn with a gradient rather than an image: this app ships no
            assets pipeline and a flat near-black panel reads as unfinished. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(120% 90% at 12% 0%, rgba(11,87,208,0.55) 0%, rgba(11,87,208,0) 55%), radial-gradient(90% 80% at 100% 100%, rgba(11,87,208,0.25) 0%, rgba(11,87,208,0) 60%)',
          }}
        />
        <div className="relative">
          <Wordmark />
        </div>
        <div className="relative max-w-md">
          <p className="text-display font-semibold leading-tight">
            Every order, from the table to the kitchen.
          </p>
          <p className="mt-3 text-base text-white/70">
            Take the ticket, price it, mark it paid — and print a QR for every table from the same
            place.
          </p>
        </div>
        <p className="relative text-xs text-white/50">
          Staff access only. Diners order from the QR code on their table.
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden">
            <WordmarkDark />
          </div>
          <h1 className="mt-6 text-display font-semibold tracking-tight lg:mt-0">Sign in</h1>
          <p className="mt-1 text-base text-muted">
            Manage your restaurant&apos;s orders and menu.
          </p>

          <div className="mt-6 space-y-3">
            <Field label="Email">
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@restaurant.com"
                />
              )}
            </Field>
            <Field label="Password">
              {({ id }) => (
                <PasswordInput
                  id={id}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
          </div>

          {error !== null ? (
            <div className="mt-3">
              {/* role=alert lives on the Notice. The message is the server's, verbatim: see the
                  comment on the catch above for why it must not be elaborated. */}
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            block
            className="mt-5"
            loading={submitting}
            loadingLabel="Signing in…"
          >
            Sign in
          </Button>

          <p className="mt-4 text-xs text-muted">
            Forgotten your password? Ask an owner to set a new one from the Staff page.
          </p>
        </form>
      </section>
    </main>
  )
}

/** The wordmark, on a dark ground. Inline SVG -- this app ships no image assets. */
function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark className="bg-white/10 text-white" />
      <span className="text-lg font-semibold tracking-tight">
        tableX <span className="font-normal text-white/60">Admin</span>
      </span>
    </span>
  )
}

/** The same wordmark for the light pane, where the form appears alone. */
function WordmarkDark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark className="bg-accent text-accent-ink" />
      <span className="text-lg font-semibold tracking-tight text-ink">
        tableX <span className="font-normal text-muted">Admin</span>
      </span>
    </span>
  )
}

function Mark({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 items-center justify-center rounded-control ${className}`}
    >
      {/* The wordmark next to it carries the name, so the mark itself is decorative. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        className="h-4 w-4"
      >
        <rect x="2.5" y="4" width="15" height="6" rx="1.5" strokeWidth="1.6" />
        <path d="M6 10v6M14 10v6" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}
