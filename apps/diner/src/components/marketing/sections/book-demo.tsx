'use client'

import { useId, useState } from 'react'
import { CONTACT_EMAIL } from '@/lib/site'

/**
 * The demo request form.
 *
 * FOUR FIELDS, AND THE FOURTH IS OPTIONAL. Every field on a form is a reason to close the tab,
 * and the three required ones are the whole intake: who you are, which restaurant, and a number
 * to call back on. City, table count and everything else belong in the conversation, not in the
 * thing standing between a prospect and the conversation.
 *
 * THERE IS NO BACKEND BEHIND THIS YET, and that is a deliberate scope decision rather than an
 * oversight -- but a form with no destination is worse than no form. A submit button that clears
 * the fields and says "thanks" while dropping the lead on the floor is the most expensive bug a
 * landing page can have, because nothing anywhere reports it: the prospect believes they made
 * contact, and the restaurant is lost silently.
 *
 * So submit composes a `mailto:` with the answers already written into the body. It needs no
 * server, no database and no spam handling, it works offline-ish, and the lead lands in an inbox
 * that already exists. The cost is honest and stated under the button: the reader's mail app
 * opens, and they still have to press send.
 *
 * TO REPLACE THIS WITH A REAL ENDPOINT, the seam is `deliver()` below and nothing else --
 * swap the `location.href` for a `fetch()`, set `sent` on a 2xx, and leave the mailto as the
 * fallback for a failed request. The markup, the validation and the states all stay.
 */

type Fields = { name: string; restaurant: string; phone: string; email: string }

const EMPTY: Fields = { name: '', restaurant: '', phone: '', email: '' }

/**
 * Ten digits, after stripping spaces, dashes and a +91.
 *
 * Deliberately loose: the only job of this check is to catch a slip of the thumb, and a
 * validator strict enough to be interesting will one day reject a real restaurant's real number
 * and cost a customer. Anything that survives this is worth a human calling back.
 */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^\+?91/, '')
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

function composeMailto(f: Fields, phone: string): string {
  const body = [
    `Restaurant: ${f.restaurant.trim()}`,
    `Name: ${f.name.trim()}`,
    `Phone: ${phone}`,
    f.email.trim() ? `Email: ${f.email.trim()}` : null,
    '',
    'I would like a demo of tableX.',
  ]
    .filter((line) => line !== null)
    .join('\n')

  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `Demo request — ${f.restaurant.trim()}`,
  )}&body=${encodeURIComponent(body)}`
}

export function BookDemoForm() {
  const uid = useId()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({})
  const [sent, setSent] = useState(false)

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [key]: e.target.value }))
    // Errors clear as the reader fixes them rather than only on the next submit -- being told
    // off for a field you are actively correcting is the most irritating form behaviour there is.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function deliver(f: Fields, phone: string) {
    // THE SEAM. Replace with `await fetch('/api/public/v1/leads', ...)` when the endpoint exists.
    window.location.href = composeMailto(f, phone)
    setSent(true)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: Partial<Record<keyof Fields, string>> = {}
    if (!fields.name.trim()) next.name = 'Please tell us your name.'
    if (!fields.restaurant.trim()) next.restaurant = 'Which restaurant is this for?'

    const phone = normalisePhone(fields.phone)
    if (!fields.phone.trim()) next.phone = 'We need a number to call you back on.'
    else if (!phone) next.phone = 'That does not look like a 10-digit mobile number.'

    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setErrors({})
    deliver(fields, phone as string)
  }

  /**
   * No contact address configured. The form is hidden rather than shown-and-broken: `site.ts`
   * already fails a production build in this state, so reaching here means a local or preview
   * build, and a dead form is more confusing there than none.
   */
  if (!CONTACT_EMAIL) return null

  if (sent) {
    return (
      <div
        className="rounded-card border border-line bg-surface p-6 text-center"
        role="status"
        aria-live="polite"
      >
        <p className="text-[1.0625rem] font-semibold text-ink">Your email app should be open.</p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-muted">
          The details are already written in — press send and we will call you back. If nothing
          opened, write to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => {
            setFields(EMPTY)
            setSent(false)
          }}
          className="mt-4 min-h-tap text-[0.9375rem] font-medium text-ink underline"
        >
          Send another
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="text-left">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${uid}-name`}
          label="Your name"
          value={fields.name}
          onChange={set('name')}
          error={errors.name}
          autoComplete="name"
        />
        <Field
          id={`${uid}-restaurant`}
          label="Restaurant name"
          value={fields.restaurant}
          onChange={set('restaurant')}
          error={errors.restaurant}
          autoComplete="organization"
        />
        <Field
          id={`${uid}-phone`}
          label="Phone"
          type="tel"
          // inputMode drives the on-screen keypad. This form is read on a phone more often than
          // not, and a full qwerty keyboard for a phone number is a small daily insult.
          inputMode="tel"
          value={fields.phone}
          onChange={set('phone')}
          error={errors.phone}
          autoComplete="tel"
        />
        <Field
          id={`${uid}-email`}
          label="Email"
          optional
          type="email"
          inputMode="email"
          value={fields.email}
          onChange={set('email')}
          error={errors.email}
          autoComplete="email"
        />
      </div>

      <button
        type="submit"
        className="mt-6 flex min-h-tap w-full items-center justify-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80 sm:w-auto sm:min-w-[15rem]"
      >
        Book a demo
      </button>
      {/* Stated before the click, not after. A button that turns out to open a mail app is a
          small betrayal if the reader was not told. */}
      <p className="mt-3 text-[0.8125rem] leading-[1.5] text-muted">
        This opens your email app with the details filled in. We reply the same day.
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  optional,
  type = 'text',
  inputMode,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  optional?: boolean
  type?: string
  inputMode?: 'tel' | 'email'
  autoComplete?: string
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[0.8125rem] font-medium text-ink">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-muted">(optional)</span> : null}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={`mt-1.5 min-h-tap w-full rounded-card border bg-surface px-3.5 text-[1rem] text-ink outline-none transition-colors placeholder:text-muted focus:border-accent ${
          error ? 'border-nonveg' : 'border-line'
        }`}
      />
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-[0.8125rem] text-nonveg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
