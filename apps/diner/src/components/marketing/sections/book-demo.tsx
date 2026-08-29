'use client'

import { isApiError } from '@tablex/api-client'
import { CODE_DEMO_ALREADY_BOOKED, CODE_DEMO_INVALID_PHONE } from '@tablex/shared'
import { useId, useState } from 'react'
import { api } from '@/lib/api'
import { CONTACT_EMAIL } from '@/lib/site'

/**
 * The demo request form.
 *
 * FOUR FIELDS, AND THE FOURTH IS OPTIONAL. Every field on a form is a reason to close the tab,
 * and the three required ones are the whole intake: who you are, which restaurant, and a number
 * to call back on. City, table count and everything else belong in the conversation, not in the
 * thing standing between a prospect and the conversation.
 *
 * IT NOW POSTS TO A REAL ENDPOINT. `POST /api/public/v1/demo-requests` records the lead and
 * emails the sales inbox, so the "thanks" this page shows is backed by a row rather than by an
 * assumption that the reader's mail app opened and they pressed send.
 *
 * THE MAILTO SURVIVES AS THE FALLBACK, and deliberately so. A submit button that clears the
 * fields and says "thanks" while dropping the lead on the floor is the most expensive bug a
 * landing page can have: nothing anywhere reports it, the prospect believes they made contact,
 * and the restaurant is lost silently. So a failed request does not show an apology and a dead
 * end -- it shows the same composed `mailto:` this form used to send everyone down, with the
 * answers already written into the body. The backend being down costs the reader one extra tap,
 * not the conversation.
 */

type Fields = { name: string; restaurant: string; phone: string; email: string }

const EMPTY: Fields = { name: '', restaurant: '', phone: '', email: '' }

/**
 * What the reader is being shown right now.
 *
 * A tagged union rather than a handful of booleans, because several of these combinations are
 * nonsense -- "sending and already booked", "sent and failed" -- and a shape that cannot express
 * them is cheaper than remembering to reset three flags on every path.
 */
type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  /** Recorded. `name` is echoed from the server rather than read from the form state we are about to clear. */
  | { kind: 'booked'; name: string }
  /** This number has asked before. Reassurance, not an error -- see below. */
  | { kind: 'already' }
  /** The request never landed. Carries the composed mailto so the lead still has somewhere to go. */
  | { kind: 'failed'; mailto: string }

/**
 * Ten digits, after stripping separators and, where the length says so, a country code.
 *
 * Deliberately loose: the only job of this check is to catch a slip of the thumb, and a
 * validator strict enough to be interesting will one day reject a real restaurant's real number
 * and cost a customer. Anything that survives this is worth a human calling back.
 *
 * THE COUNTRY CODE COMES OFF ONLY WHEN THE LENGTH SAYS IT IS ONE. An unconditional strip of a
 * leading `91` looks equivalent and is not: `91xxxxxxxx` is itself a live Indian mobile range,
 * so `9123456780` would be mangled into an eight-digit fragment and its owner told their own
 * number is invalid. This mirrors `normaliseDemoPhone` in the backend exactly, and it has to --
 * the server is what decides, and a client that disagrees either blocks a valid number here or
 * promises one the server then rejects.
 */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().+]/g, '')

  let local = digits
  if (digits.length === 13 && digits.startsWith('091')) local = digits.slice(3)
  else if (digits.length === 12 && digits.startsWith('91')) local = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) local = digits.slice(1)

  return /^[6-9]\d{9}$/.test(local) ? local : null
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
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [key]: e.target.value }))
    // Errors clear as the reader fixes them rather than only on the next submit -- being told
    // off for a field you are actively correcting is the most irritating form behaviour there is.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function reset() {
    setFields(EMPTY)
    setErrors({})
    setStatus({ kind: 'idle' })
  }

  async function deliver(f: Fields, phone: string) {
    setStatus({ kind: 'sending' })
    try {
      // The phone is sent AS TYPED, not as normalised above. The server normalises, and its
      // answer is what "one demo per number" is defined in terms of -- sending the client's
      // version would make this the second place that decides, and the day the two disagree is
      // the day a duplicate slips through with nothing to show for it.
      const booked = await api.bookDemo({
        name: f.name.trim(),
        restaurant_name: f.restaurant.trim(),
        phone: f.phone.trim(),
        email: f.email.trim() || undefined,
      })
      setFields(EMPTY)
      setStatus({ kind: 'booked', name: booked.name })
      return
    } catch (err) {
      if (isApiError(err)) {
        // Already booked. NOT rendered as a failure: an owner submitting twice has almost always
        // just missed the first confirmation, and telling them something went wrong invites a
        // third attempt and a worse impression than saying plainly that we have it.
        if (err.code === CODE_DEMO_ALREADY_BOOKED) {
          setFields(EMPTY)
          setStatus({ kind: 'already' })
          return
        }
        // The server disagreed about the number. Sent back to the field it belongs to rather than
        // shown as a page-level failure -- it is a correctable typo, and the form still holds
        // everything else the reader typed.
        if (err.code === CODE_DEMO_INVALID_PHONE) {
          setErrors({ phone: err.message })
          setStatus({ kind: 'idle' })
          return
        }
      }
      // Anything else -- the API is down, the deploy is mid-flight, the phone dropped off wifi.
      // The reader is not told about any of that; they are handed the other way to reach us.
      setStatus({ kind: 'failed', mailto: composeMailto(f, phone) })
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status.kind === 'sending') return

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
    void deliver(fields, phone as string)
  }

  /**
   * No contact address configured. The form is hidden rather than shown-and-broken: `site.ts`
   * already fails a production build in this state, so reaching here means a local or preview
   * build, and a dead form is more confusing there than none.
   */
  if (!CONTACT_EMAIL) return null

  if (status.kind === 'booked') {
    return (
      <Panel>
        <p className="text-[1.0625rem] font-semibold text-ink">
          {status.name.trim()
            ? `Thanks, ${status.name.trim().split(' ')[0]} — that's booked.`
            : "That's booked."}
        </p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-muted">
          We have your details and someone will call you on the number you gave, usually the same
          day. Nothing else is needed from you now.
        </p>
        <PanelFooter onReset={reset} resetLabel="Book another restaurant" />
      </Panel>
    )
  }

  if (status.kind === 'already') {
    return (
      <Panel>
        <p className="text-[1.0625rem] font-semibold text-ink">You are already on the list.</p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-muted">
          We already have a demo request against that number, so there is no need to send another —
          we will call you. If it has been more than a day, write to <ContactLink /> and we will
          find you.
        </p>
        <PanelFooter onReset={reset} resetLabel="Book a different restaurant" />
      </Panel>
    )
  }

  if (status.kind === 'failed') {
    return (
      <Panel>
        <p className="text-[1.0625rem] font-semibold text-ink">We could not reach our server.</p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-muted">
          Your details are not lost — the button below opens your email app with all of them already
          written in. Press send and we will call you back.
        </p>
        {/* An anchor rather than a scripted navigation: it is the reader's own decision to open
            their mail app, and a link is the one control that behaves correctly when they would
            rather long-press and copy the address instead. */}
        <a
          href={status.mailto}
          className="mt-4 inline-flex min-h-tap items-center justify-center rounded-card bg-accent px-6 text-[1rem] font-semibold text-accent-ink"
        >
          Email us instead
        </a>
        <PanelFooter onReset={reset} resetLabel="Try the form again" />
      </Panel>
    )
  }

  const sending = status.kind === 'sending'

  return (
    <form onSubmit={onSubmit} noValidate className="text-left">
      {/* fieldset disabled is what actually stops a second submit -- disabling the button alone
          leaves Enter-in-a-text-field working, which on a slow connection is exactly how one
          person becomes two leads. */}
      <fieldset disabled={sending} className="contents">
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
          className="mt-6 flex min-h-tap w-full items-center justify-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80 disabled:opacity-70 sm:w-auto sm:min-w-[15rem]"
        >
          {sending ? 'Booking…' : 'Book a demo'}
        </button>
      </fieldset>

      {/* Announced rather than only shown, so a screen reader hears that the form is working
          instead of meeting a button that has silently stopped responding. */}
      <p
        className="mt-3 text-[0.8125rem] leading-[1.5] text-muted"
        role="status"
        aria-live="polite"
      >
        {sending
          ? 'Sending your details…'
          : 'No obligation, and we will not add you to a mailing list. We reply the same day.'}
      </p>
    </form>
  )
}

/** The shared shell for the three post-submit states, so they cannot drift apart visually. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-card border border-line bg-surface p-6 text-center"
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  )
}

function PanelFooter({ onReset, resetLabel }: { onReset: () => void; resetLabel: string }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="mt-4 min-h-tap text-[0.9375rem] font-medium text-ink underline"
    >
      {resetLabel}
    </button>
  )
}

function ContactLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent underline">
      {CONTACT_EMAIL}
    </a>
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
        className={`mt-1.5 min-h-tap w-full rounded-card border bg-surface px-3.5 text-[1rem] text-ink outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-60 ${
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
