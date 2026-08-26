'use client'

import { isApiError } from '@tablex/api-client'
import type { RestaurantSettings, UpdateRestaurantRequest } from '@tablex/shared'
import { ErrorState, Spinner } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import { api } from '@/lib/api'

/**
 * Percent in the UI, basis points on the wire.
 *
 * The API stores rates as integer basis points (500 = 5.00%) so every money computation stays in
 * integer arithmetic (docs/DECISIONS.md D7). A manager thinks in percent, so the conversion
 * happens here -- and only here.
 */
function bpsToPercent(bps: number): string {
  const percent = bps / 100
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2)
}

function percentToBps(raw: string): number | null {
  const value = raw.trim()
  if (value === '') return 0
  if (!/^\d*(\.\d{1,2})?$/.test(value)) return null

  const percent = Number.parseFloat(value)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null

  // Rounded because 7.35% is 735 bps exactly, but floating-point multiplication can land on
  // 734.9999999. This is the one place a float touches a rate, and it is immediately made
  // integral again.
  return Math.round(percent * 100)
}

/**
 * The two payment providers, each with the fact an owner actually needs at the moment of
 * choosing (docs/DECISIONS.md D2): static UPI cannot confirm that money arrived. The longer
 * warning below the control stays -- this is the one-line version, at the point of decision.
 */
const PROVIDER_OPTIONS: readonly SelectOption[] = [
  {
    value: 'upi_static',
    label: 'UPI QR from your own account',
    description: 'No fees. Payments must be confirmed by hand.',
  },
  {
    value: 'razorpay',
    label: 'Razorpay gateway',
    description: 'Confirms payments automatically. Needs Razorpay keys.',
  },
]

export function SettingsForm() {
  const auth = useRequireAuth()
  const { getToken } = useAuth()

  const [settings, setSettings] = useState<RestaurantSettings | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    address: '',
    phone: '',
    gstNumber: '',
    taxPercent: '',
    servicePercent: '',
    upiVpa: '',
    upiPayeeName: '',
    paymentProvider: 'upi_static',
  })

  const canEdit = auth?.staff.role === 'owner' || auth?.staff.role === 'manager'

  const load = useCallback(() => {
    getToken().then((token) => {
      if (!token) return
      api
        .getSettings(token)
        .then((result) => {
          setSettings(result)
          setForm({
            name: result.name,
            description: result.description ?? '',
            address: result.address ?? '',
            phone: result.phone ?? '',
            gstNumber: result.gst_number ?? '',
            taxPercent: bpsToPercent(result.tax_bps),
            servicePercent: bpsToPercent(result.service_charge_bps),
            upiVpa: result.upi_vpa ?? '',
            upiPayeeName: result.upi_payee_name ?? '',
            paymentProvider: result.payment_provider,
          })
          setError(null)
        })
        .catch(setError)
    })
  }, [getToken])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(() => {
    const taxBps = percentToBps(form.taxPercent)
    const serviceBps = percentToBps(form.servicePercent)

    if (taxBps === null) {
      setNotice('Tax must be a percentage between 0 and 100, with at most two decimals.')
      return
    }
    if (serviceBps === null) {
      setNotice('Service charge must be a percentage between 0 and 100.')
      return
    }

    const body: UpdateRestaurantRequest = {
      name: form.name.trim(),
      description: form.description.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      gst_number: form.gstNumber.trim(),
      tax_bps: taxBps,
      service_charge_bps: serviceBps,
      upi_vpa: form.upiVpa.trim(),
      upi_payee_name: form.upiPayeeName.trim(),
      payment_provider: form.paymentProvider,
    }

    setBusy(true)
    setNotice(null)
    getToken().then((token) => {
      if (!token) {
        setBusy(false)
        return
      }
      api
        .updateSettings(token, body)
        .then((result) => {
          setSettings(result)
          setBusy(false)
          setNotice('Saved.')
        })
        .catch((err: unknown) => {
          setBusy(false)
          setNotice(isApiError(err) ? err.message : 'Could not save.')
        })
    })
  }, [form, getToken])

  if (auth === null) return null

  // Loose, and a warning rather than a block: VPA formats vary by bank, and refusing a valid
  // one the app has not seen before would stop a restaurant taking payment.
  const vpaLooksOdd = form.upiVpa.trim() !== '' && !/^[^\s@]+@[^\s@]+$/.test(form.upiVpa.trim())

  return (
    <>
      <PageHeader title="Settings" subtitle={canEdit ? undefined : 'Read only'} />

      {notice !== null ? (
        <p
          role="status"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      ) : null}

      <main className="p-4">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load settings.'}
            onRetry={load}
          />
        ) : settings === null ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Spinner /> Loading
          </div>
        ) : (
          <div className="grid max-w-3xl gap-4">
            <Card title="Restaurant">
              <Field
                label="Name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                disabled={!canEdit}
              />
              <Field
                label="Description"
                value={form.description}
                onChange={(v) => setForm({ ...form, description: v })}
                disabled={!canEdit}
              />
              <Field
                label="Address"
                value={form.address}
                onChange={(v) => setForm({ ...form, address: v })}
                disabled={!canEdit}
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted">
                Timezone: <strong>{settings.timezone}</strong>. Daily order numbers and the
                dashboard&apos;s figures roll over at midnight in this zone.
              </p>
            </Card>

            <Card title="Tax">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="GST (%)"
                  value={form.taxPercent}
                  onChange={(v) => setForm({ ...form, taxPercent: v })}
                  disabled={!canEdit}
                  numeric
                />
                <Field
                  label="Service charge (%)"
                  value={form.servicePercent}
                  onChange={(v) => setForm({ ...form, servicePercent: v })}
                  disabled={!canEdit}
                  numeric
                />
              </div>
              <Field
                label="GST number"
                value={form.gstNumber}
                onChange={(v) => setForm({ ...form, gstNumber: v })}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted">
                Applied to every new order. Orders already placed keep the rate they were priced at,
                so changing this never alters an existing bill.
              </p>
            </Card>

            <Card title="Payments">
              <Select
                label="Provider"
                value={form.paymentProvider}
                disabled={!canEdit}
                onChange={(paymentProvider) => setForm({ ...form, paymentProvider })}
                options={PROVIDER_OPTIONS}
                className="w-full"
              />

              {/*
                The most important copy on this page. An owner switching online payments on has to
                understand that static UPI cannot confirm a transfer -- otherwise they will expect
                orders to settle themselves, and unpaid orders will pile up unnoticed
                (docs/DECISIONS.md D2).
              */}
              {form.paymentProvider === 'upi_static' ? (
                <div className="rounded-card border border-line bg-surface-sunken p-3 text-xs leading-relaxed">
                  <p className="font-semibold">Payments need to be confirmed by hand.</p>
                  <p className="mt-1 text-muted">
                    A UPI transfer into your own bank account is invisible to this system — there is
                    no way for us to detect it. Diners will see &ldquo;awaiting confirmation&rdquo;
                    and a staff member has to tap <strong>Mark as paid</strong> once the money
                    arrives, exactly as you would with cash.
                  </p>
                  <p className="mt-1 text-muted">
                    Every payment carries a reference that appears in your bank notification, so you
                    can match them up. If you want payments confirmed automatically, use the
                    Razorpay gateway instead.
                  </p>
                </div>
              ) : (
                <p className="rounded-card border border-line bg-surface-sunken p-3 text-xs text-muted">
                  Razorpay confirms payments automatically. It only works once the gateway
                  credentials are configured on the server; until then payments fall back to a UPI
                  QR from your own account.
                </p>
              )}

              <Field
                label="UPI ID (VPA)"
                value={form.upiVpa}
                onChange={(v) => setForm({ ...form, upiVpa: v })}
                disabled={!canEdit}
                placeholder="restaurant@okhdfcbank"
              />
              {vpaLooksOdd ? (
                <p className="text-xs text-danger">
                  That does not look like a UPI ID — they are usually name@bank. Double-check it
                  before saving; a wrong one sends diners&apos; money elsewhere.
                </p>
              ) : null}
              <Field
                label="Payee name shown in the diner's UPI app"
                value={form.upiPayeeName}
                onChange={(v) => setForm({ ...form, upiPayeeName: v })}
                disabled={!canEdit}
              />
            </Card>

            {canEdit ? (
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className="min-h-tap rounded-card bg-accent px-5 text-sm font-semibold text-accent-ink disabled:opacity-40"
                >
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted">
                Only owners and managers can change these. The server enforces this regardless of
                what this screen shows.
              </p>
            )}
          </div>
        )}
      </main>
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  numeric,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  numeric?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={numeric ? 'decimal' : 'text'}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-tap w-full rounded-card border border-line bg-bg px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
      />
    </label>
  )
}
