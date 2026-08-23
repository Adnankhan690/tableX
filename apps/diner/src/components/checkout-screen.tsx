'use client'

import { isApiError, newIdempotencyKey } from '@tablex/api-client'
import type { PaymentMethod } from '@tablex/shared'
import { formatINR, PAYMENT_METHOD_LABEL } from '@tablex/shared'
import { cn, Spinner } from '@tablex/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/providers'
import { BottomBar, PrimaryButton, ScreenHeader } from '@/components/screen'
import { useGatedSession } from '@/components/session-gate'
import { api } from '@/lib/api'
import { toOrderItems } from '@/lib/cart'

type Failure =
  | { kind: 'unavailable'; message: string }
  | { kind: 'upi-unconfigured'; message: string }
  /** The request may or may not have created the order -- see the note where this is set. */
  | { kind: 'uncertain'; message: string }
  | { kind: 'other'; message: string }

/** Payment choice and submission (PRD 6.4). */
export function CheckoutScreen() {
  const session = useGatedSession()

  const router = useRouter()
  const { cart, clear } = useCart()

  const [method, setMethod] = useState<PaymentMethod>('counter')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  /**
   * ONE idempotency key for this screen, generated once and reused for every attempt
   * (docs/DECISIONS.md D12).
   *
   * A ref, not state, because a re-render must not produce a new key. Generating a fresh key
   * per attempt would defeat the entire mechanism: each retry would look like a new order to
   * the server, and the double-tap this exists to absorb would send two tickets to the kitchen.
   */
  const idempotencyKey = useRef(newIdempotencyKey())

  const subtotal = useMemo(
    () => cart?.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0) ?? 0,
    [cart],
  )

  const place = useCallback(() => {
    if (cart === null || cart.lines.length === 0 || submitting) return

    setSubmitting(true)
    setFailure(null)

    api
      .placeOrder(
        session.token,
        {
          items: toOrderItems(cart),
          payment_method: method,
          ...(name.trim() ? { customer_name: name.trim() } : {}),
          ...(phone.trim() ? { customer_phone: phone.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        idempotencyKey.current,
      )
      .then((result) => {
        // Only this table's cart is cleared; a diner who moves tables keeps that table's cart.
        clear()
        router.replace(`/orders/${result.order.uid}`)
      })
      .catch((err: unknown) => {
        setSubmitting(false)

        if (!isApiError(err)) {
          setFailure({
            kind: 'other',
            message: 'Something went wrong. Please try again.',
          })
          return
        }

        // Ordinary rather than exceptional: the menu may have been open for twenty minutes
        // while the kitchen ran out.
        if (err.code === 'TX_MNU_018') {
          setFailure({ kind: 'unavailable', message: err.message })
          return
        }

        // The restaurant never finished payment setup. Not a dead end -- the counter still
        // works, so the diner is offered that rather than being stuck.
        if (err.code === 'TX_RST_007') {
          setMethod('counter')
          setFailure({ kind: 'upi-unconfigured', message: err.message })
          return
        }

        /**
         * A network failure is genuinely ambiguous: the request may have reached the server and
         * committed before the connection dropped. Saying so is better than a confident "that
         * failed", because a diner who retries into a duplicate order loses trust in the whole
         * system.
         *
         * The idempotency key does make a retry safe here -- a replay returns the original
         * order rather than creating a second. The honest message is still preferable, because
         * "check your orders" resolves the ambiguity in one tap and needs no explanation.
         */
        if (err.status === 0) {
          setFailure({
            kind: 'uncertain',
            message:
              'We could not confirm whether your order went through. Check your orders before trying again.',
          })
          return
        }

        setFailure({ kind: 'other', message: err.message })
      })
  }, [cart, submitting, session.token, method, name, phone, note, clear, router])

  if (cart === null || cart.lines.length === 0) {
    return (
      <>
        <ScreenHeader title="Payment" subtitle={`Table ${session.tableLabel}`} />
        <main className="px-4 py-16 text-center">
          <p className="text-[0.9375rem] text-muted">Your cart is empty.</p>
          <Link href="/menu" className="mt-3 inline-block text-[0.9375rem] font-medium text-accent">
            Back to the menu
          </Link>
        </main>
      </>
    )
  }

  return (
    <>
      <ScreenHeader
        title="Payment"
        subtitle={`Table ${session.tableLabel}`}
        back={
          <Link
            href="/cart"
            aria-label="Back to your order"
            className="-ml-2 flex min-h-tap min-w-tap items-center justify-center text-xl text-muted"
          >
            ←
          </Link>
        }
      />

      <main className="px-4 pb-bar pt-4">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
          How would you like to pay?
        </h2>

        <div className="mt-3 space-y-3">
          <MethodOption
            method="online_upi"
            selected={method === 'online_upi'}
            onSelect={setMethod}
            title={PAYMENT_METHOD_LABEL.online_upi}
            body="Pay now from any UPI app on your phone."
          />
          <MethodOption
            method="counter"
            selected={method === 'counter'}
            onSelect={setMethod}
            title={PAYMENT_METHOD_LABEL.counter}
            body="Order now, pay by cash or card when you leave."
          />
        </div>

        <h2 className="mt-6 text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
          Anything else? (optional)
        </h2>
        <div className="mt-3 space-y-3">
          <Field label="Your name" value={name} onChange={setName} maxLength={128} />
          <Field
            label="Phone number"
            value={phone}
            onChange={setPhone}
            maxLength={20}
            type="tel"
            // Said explicitly because asking for a phone number in an app with no login looks
            // like account creation, which is exactly the friction this product removes
            // (docs/DECISIONS.md D5).
            hint="Only so staff can reach you about this order. No account is created."
          />
          <Field
            label="Note for the kitchen"
            value={note}
            onChange={setNote}
            maxLength={500}
            hint="Allergies, spice level, anything else."
          />
        </div>

        {failure !== null ? (
          <div
            role="alert"
            className="mt-5 rounded-card border border-line bg-surface p-3 text-[0.875rem]"
          >
            <p className="font-medium text-nonveg">{failure.message}</p>
            {failure.kind === 'unavailable' ? (
              <Link href="/cart" className="mt-2 inline-block font-medium text-accent">
                Go back and update your order
              </Link>
            ) : null}
            {failure.kind === 'uncertain' ? (
              <Link href="/orders" className="mt-2 inline-block font-medium text-accent">
                Check my orders
              </Link>
            ) : null}
            {failure.kind === 'upi-unconfigured' ? (
              <p className="mt-1 text-muted">Pay at the counter has been selected for you.</p>
            ) : null}
          </div>
        ) : null}
      </main>

      <BottomBar>
        <PrimaryButton onClick={place} disabled={submitting}>
          {submitting ? (
            <>
              <Spinner /> Placing your order
            </>
          ) : (
            `Place order · ${formatINR(subtotal)}+`
          )}
        </PrimaryButton>
        <p className="mt-2 text-center text-[0.75rem] text-muted">
          Taxes are added to the total shown on the next screen.
        </p>
      </BottomBar>
    </>
  )
}

function MethodOption({
  method,
  selected,
  onSelect,
  title,
  body,
}: {
  method: PaymentMethod
  selected: boolean
  onSelect: (method: PaymentMethod) => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(method)}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 rounded-card border p-4 text-left transition-colors',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          selected ? 'border-accent' : 'border-line',
        )}
      >
        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[1rem] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">{body}</span>
      </span>
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  hint,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  hint?: string
  type?: 'text' | 'tel'
}) {
  return (
    <label className="block">
      <span className="text-[0.8125rem] font-medium text-ink">{label}</span>
      <input
        type={type}
        // A numeric keypad for a phone number: on a phone the default keyboard costs the diner
        // an extra tap to reach the digits.
        inputMode={type === 'tel' ? 'tel' : 'text'}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-tap w-full rounded-card border border-line bg-surface px-3 text-[0.9375rem] outline-none focus:border-accent"
      />
      {hint ? (
        <span className="mt-1 block text-[0.75rem] leading-snug text-muted">{hint}</span>
      ) : null}
    </label>
  )
}
