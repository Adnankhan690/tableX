'use client'

import type { PaymentView } from '@tablex/shared'
import { Base64Image } from '@tablex/ui'
import { useState } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/screen'

/**
 * The UPI payment block (docs/DECISIONS.md D2).
 *
 * The important product decision is what this does NOT render: there is no indefinite
 * spinner. Static UPI cannot observe a bank transfer, so nothing will ever arrive to resolve
 * one, and a diner left watching it would conclude the app is broken. When
 * `requires_manual_confirmation` is set, the panel says plainly that a staff member confirms
 * the payment.
 */
export function PaymentPanel({ payment }: { payment: PaymentView }) {
  const [showQR, setShowQR] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyReference = () => {
    // navigator.clipboard is unavailable on http origins and in some in-app browsers. The
    // reference is displayed as text regardless, so a failure here costs a convenience, not
    // the ability to pay.
    navigator.clipboard
      ?.writeText(payment.reference)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        /* Selectable text is the fallback. */
      })
  }

  if (payment.status === 'paid') {
    return (
      <section className="rounded-card border border-veg bg-surface p-4">
        <p className="text-[0.9375rem] font-semibold text-veg">Payment received</p>
        <p className="mt-1 text-[0.8125rem] text-muted">Reference {payment.reference}</p>
      </section>
    )
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[0.9375rem] font-semibold">Pay {payment.amount.display}</p>
        <span className="text-[0.75rem] uppercase tracking-wide text-muted">UPI</span>
      </div>

      {payment.upi_intent_url ? (
        <div className="mt-3 space-y-2">
          {/*
            An <a> to the upi:// scheme, not a fetch. The phone's OS resolves it to whichever
            UPI app the diner has installed, and a button with a click handler could not do
            that.
          */}
          <a href={payment.upi_intent_url} className="block">
            <PrimaryButton>Open your UPI app</PrimaryButton>
          </a>

          {payment.qr_png_base64 ? (
            <>
              <SecondaryButton onClick={() => setShowQR((value) => !value)}>
                {showQR ? 'Hide QR code' : 'Show QR code instead'}
              </SecondaryButton>
              {showQR ? (
                <div className="flex flex-col items-center gap-2 pt-2">
                  <Base64Image
                    png={payment.qr_png_base64}
                    alt={`UPI QR code to pay ${payment.amount.display}`}
                    size={220}
                    className="rounded-card p-2"
                  />
                  <p className="text-center text-[0.75rem] leading-snug text-muted">
                    Scan this from another phone if you are paying for someone else.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/*
        The reference is the diner's proof and the staff member's matching key: a bank
        notification arrives with this string in it, and that is the whole reconciliation
        story for static UPI (docs/DECISIONS.md D2). Hence the prominence and the copy button.
      */}
      <div className="mt-4 rounded-card bg-surface-sunken p-3">
        <p className="text-[0.75rem] uppercase tracking-wide text-muted">Payment reference</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <code className="select-all text-[0.9375rem] font-semibold tracking-wide">
            {payment.reference}
          </code>
          <button
            type="button"
            onClick={copyReference}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {payment.requires_manual_confirmation ? (
        <p className="mt-3 text-[0.8125rem] leading-snug text-muted">
          After paying, a staff member confirms your payment — this can take a few minutes. Show
          them the reference above if you need to.
        </p>
      ) : (
        <p className="mt-3 text-[0.8125rem] leading-snug text-muted">
          This screen updates automatically once your payment is confirmed.
        </p>
      )}
    </section>
  )
}
