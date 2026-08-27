'use client'

import { isApiError } from '@tablex/api-client'
import type { RestaurantSettings, UpdateRestaurantRequest } from '@tablex/shared'
import { ErrorState } from '@tablex/ui'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useRequireAuth } from '@/components/auth-provider'
import { PageHeader } from '@/components/page-header'
import { Select, type SelectOption } from '@/components/select'
import { Button, Card, Field, Input, Notice, Skeleton } from '@/components/ui'
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
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  /**
   * Validation errors keyed by field.
   *
   * They used to be one banner string at the top of a 2,400px page: "GST must be between 0 and 30"
   * left the manager to work out which of eight numeric inputs it meant.
   */
  const [fieldErrors, setFieldErrors] = useState<{ tax?: string; service?: string }>({})
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

    const errors: { tax?: string; service?: string } = {}
    if (taxBps === null) {
      errors.tax = 'A percentage between 0 and 100, with at most two decimals.'
    }
    if (serviceBps === null) {
      errors.service = 'A percentage between 0 and 100.'
    }
    setFieldErrors(errors)
    if (taxBps === null || serviceBps === null) {
      setNotice({ tone: 'danger', text: 'Two fields need fixing before this can be saved.' })
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
          setNotice({ tone: 'success', text: 'Settings saved.' })
        })
        .catch((err: unknown) => {
          setBusy(false)
          setNotice({ tone: 'danger', text: isApiError(err) ? err.message : 'Could not save.' })
        })
    })
  }, [form, getToken])

  if (auth === null) return null

  // Loose, and a warning rather than a block: VPA formats vary by bank, and refusing a valid
  // one the app has not seen before would stop a restaurant taking payment.
  const vpaLooksOdd = form.upiVpa.trim() !== '' && !/^[^\s@]+@[^\s@]+$/.test(form.upiVpa.trim())

  /** Nothing to save until something changed -- and a Save that is always live teaches nothing. */
  const dirty =
    settings !== null &&
    (form.name !== settings.name ||
      form.description !== (settings.description ?? '') ||
      form.address !== (settings.address ?? '') ||
      form.phone !== (settings.phone ?? '') ||
      form.gstNumber !== (settings.gst_number ?? '') ||
      form.upiVpa !== (settings.upi_vpa ?? '') ||
      form.upiPayeeName !== (settings.upi_payee_name ?? '') ||
      form.paymentProvider !== settings.payment_provider ||
      percentToBps(form.taxPercent) !== settings.tax_bps ||
      percentToBps(form.servicePercent) !== settings.service_charge_bps)

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={canEdit ? 'How this restaurant bills and takes payment' : 'Read only'}
      />

      {notice !== null ? (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <main className="p-4 pb-24">
        {error !== null ? (
          <ErrorState
            message={isApiError(error) ? error.message : 'Could not load settings.'}
            onRetry={load}
          />
        ) : settings === null ? (
          <div className="mx-auto max-w-4xl space-y-4">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-tap w-full" />
                <Skeleton className="h-tap w-full" />
              </Card>
            ))}
          </div>
        ) : (
          /*
            A two-column layout on a wide screen: the form used to be a 768px column on a 2,560px
            content area, with more than half the screen empty and every field -- including a
            two-character percentage -- stretched to full width. The left column names the section
            and says why it matters, the right holds the controls, which is also what gives a long
            settings page scannable structure.
          */
          <div className="mx-auto max-w-4xl divide-y divide-divider">
            <Section
              title="Restaurant"
              description="What diners see at the top of the menu and on their receipt."
            >
              <Field label="Name">
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.name}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Description" optional>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.description}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Address">
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.address}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={form.phone}
                      disabled={!canEdit}
                      inputMode="tel"
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Timezone" hint="Set when the restaurant was onboarded.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={settings.timezone}
                      disabled
                    />
                  )}
                </Field>
              </div>
              <p className="text-xs text-muted">
                Daily order numbers and the dashboard&apos;s figures roll over at midnight in this
                zone.
              </p>
            </Section>

            <Section
              title="Tax"
              description="Applied to every new order. Orders already placed keep the rate they were priced at, so changing this never alters an existing bill."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Sized to their content: a two-character percentage in a 700px box invites the
                    manager to wonder what else belongs in it. */}
                <Field label="GST" error={fieldErrors.tax} hint="Percentage of the subtotal.">
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={form.taxPercent}
                      disabled={!canEdit}
                      inputMode="decimal"
                      numeric
                      suffix="%"
                      className="max-w-[9rem]"
                      onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Service charge"
                  error={fieldErrors.service}
                  hint="Leave at 0 if you do not charge one."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={form.servicePercent}
                      disabled={!canEdit}
                      inputMode="decimal"
                      numeric
                      suffix="%"
                      className="max-w-[9rem]"
                      onChange={(e) => setForm({ ...form, servicePercent: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label="GST number" optional>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.gstNumber}
                    disabled={!canEdit}
                    className="max-w-md"
                    onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
                  />
                )}
              </Field>
            </Section>

            <Section
              title="Payments"
              description="How a diner pays, and whether this system can tell that they did."
            >
              <Select
                label="Provider"
                value={form.paymentProvider}
                disabled={!canEdit}
                onChange={(paymentProvider) => setForm({ ...form, paymentProvider })}
                options={PROVIDER_OPTIONS}
                className="w-full max-w-md"
              />

              {/*
                The most important copy on this page, and now weighted like it. An owner switching
                online payments on has to understand that static UPI cannot confirm a transfer --
                otherwise they will expect orders to settle themselves, and unpaid orders will pile
                up unnoticed (docs/DECISIONS.md D2). It used to be 12px muted text in a grey box.
              */}
              {form.paymentProvider === 'upi_static' ? (
                <Notice tone="warning" title="Payments need to be confirmed by hand.">
                  <p>
                    A UPI transfer into your own bank account is invisible to this system — there is
                    no way for us to detect it. Diners will see &ldquo;awaiting confirmation&rdquo;
                    and a staff member has to tap <strong>Mark as paid</strong> once the money
                    arrives, exactly as you would with cash.
                  </p>
                  <p className="mt-1.5">
                    Every payment carries a reference that appears in your bank notification, so you
                    can match them up. If you want payments confirmed automatically, use the
                    Razorpay gateway instead.
                  </p>
                </Notice>
              ) : (
                <Notice tone="accent" title="Razorpay confirms payments automatically.">
                  It only works once the gateway credentials are configured on the server; until
                  then payments fall back to a UPI QR from your own account.
                </Notice>
              )}

              <Field
                label="UPI ID (VPA)"
                error={
                  vpaLooksOdd
                    ? 'That does not look like a UPI ID — they are usually name@bank. A wrong one sends diners’ money elsewhere.'
                    : undefined
                }
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={form.upiVpa}
                    disabled={!canEdit}
                    className="max-w-md"
                    placeholder="restaurant@okhdfcbank"
                    onChange={(e) => setForm({ ...form, upiVpa: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Payee name" hint="Shown in the diner's UPI app when they pay.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={form.upiPayeeName}
                    disabled={!canEdit}
                    className="max-w-md"
                    onChange={(e) => setForm({ ...form, upiPayeeName: e.target.value })}
                  />
                )}
              </Field>
            </Section>
          </div>
        )}
      </main>

      {/*
        The save bar is pinned, because the form is taller than any screen it runs on: "Save
        settings" used to be the last element of a 2,470px scroll, so the manager had to scroll past
        everything to commit a one-character change to the phone number. It also states whether
        there is anything to save, which the old always-enabled button did not.
      */}
      {canEdit && settings !== null ? (
        <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
          <p className="text-sm text-muted">
            {dirty ? 'Unsaved changes' : 'Everything here is saved.'}
          </p>
          <Button
            variant="primary"
            disabled={!dirty}
            loading={busy}
            loadingLabel="Saving…"
            onClick={save}
          >
            Save settings
          </Button>
        </div>
      ) : settings !== null ? (
        <div className="border-t border-line bg-surface px-4 py-3">
          <p className="text-sm text-muted">
            Only owners and managers can change these. The server enforces this regardless of what
            this screen shows.
          </p>
        </div>
      ) : null}
    </>
  )
}

/**
 * One group of settings: what it is on the left, the controls on the right.
 *
 * Ruled, not boxed. Three bordered cards in a column read as three unrelated objects; a ruled
 * section reads as one form with parts, which is what it is.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-4 py-6 first:pt-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  )
}
