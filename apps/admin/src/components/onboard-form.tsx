'use client'

import { isApiError } from '@tablex/api-client'
import type { OnboardRestaurantRequest, OnboardRestaurantResponse } from '@tablex/shared'
import { useMemo, useState } from 'react'
import {
  Button,
  CardHeader,
  Input,
  Notice,
  Card as UICard,
  Field as UIField,
} from '@/components/ui'
import { checkTableRange, parsePercentToBps, slugPreview } from '@/lib/onboard-input'
import { platformApi } from '@/lib/platform'
import { OnboardResult } from './onboard-result'

/**
 * Onboarding a restaurant: the operator screen (docs/DECISIONS.md D14).
 *
 * Deliberately outside `AppShell` and outside `useRequireAuth`. Every other screen in this app
 * belongs to one restaurant and is reached with a staff JWT; this one belongs to the deployment
 * and is reached with the platform token, so borrowing the tenant chrome would imply a
 * restaurant context that does not exist yet -- and `useRequireAuth` would bounce an operator
 * who has no staff account to the login page.
 *
 * The token lives in React state only. Never localStorage: unlike a staff access token it does
 * not expire and it creates tenants (see lib/platform.ts).
 */
export function OnboardForm() {
  const [token, setToken] = useState('')

  const [form, setForm] = useState({
    name: '',
    slug: '',
    address: '',
    phone: '',
    timezone: 'Asia/Kolkata',
    gstNumber: '',
    taxPercent: '5',
    servicePercent: '',
    upiVpa: '',
    upiPayeeName: '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
    tablePrefix: 'T-',
    tableFrom: '1',
    tableTo: '10',
  })
  const [withTables, setWithTables] = useState(true)

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [result, setResult] = useState<OnboardRestaurantResponse | null>(null)

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))

  // The URL the restaurant is about to be given permanently. Shown before submitting because
  // /r/{slug} goes onto printed signage; the server re-normalises and is authoritative.
  const derivedSlug = useMemo(
    () => slugPreview(form.slug.trim() === '' ? form.name : form.slug),
    [form.name, form.slug],
  )

  // Loose, and a warning rather than a block -- the same call the Settings screen makes. VPA
  // formats vary by bank, and refusing a valid one this app has not seen before would stop a
  // restaurant taking payment on day one.
  const vpaLooksOdd = form.upiVpa.trim() !== '' && !/^[^\s@]+@[^\s@]+$/.test(form.upiVpa.trim())

  const range = useMemo(
    () => checkTableRange(Number.parseInt(form.tableFrom, 10), Number.parseInt(form.tableTo, 10)),
    [form.tableFrom, form.tableTo],
  )

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return

    const tax = parsePercentToBps(form.taxPercent)
    if (!tax.ok) {
      setProblem(`GST: ${tax.error}`)
      return
    }
    const service = parsePercentToBps(form.servicePercent)
    if (!service.ok) {
      setProblem(`Service charge: ${service.error}`)
      return
    }
    if (withTables && !range.ok) {
      setProblem(`Tables: ${range.error}`)
      return
    }

    // Empty optional strings are dropped rather than sent as "". The server trims and stores
    // either way, but a payload that says only what the operator actually filled in is the one
    // that reads correctly in a log when someone asks what a restaurant was created with.
    const body: OnboardRestaurantRequest = {
      name: form.name.trim(),
      timezone: form.timezone.trim(),
      owner: {
        name: form.ownerName.trim(),
        email: form.ownerEmail.trim(),
        password: form.ownerPassword,
      },
    }
    if (form.slug.trim() !== '') body.slug = form.slug.trim()
    if (form.address.trim() !== '') body.address = form.address.trim()
    if (form.phone.trim() !== '') body.phone = form.phone.trim()
    if (form.gstNumber.trim() !== '') body.gst_number = form.gstNumber.trim()
    if (form.upiVpa.trim() !== '') body.upi_vpa = form.upiVpa.trim()
    if (form.upiPayeeName.trim() !== '') body.upi_payee_name = form.upiPayeeName.trim()
    // `undefined` means "left blank, inherit the schema default"; 0 means "no tax". The parser
    // keeps those apart and so must this.
    if (tax.bps !== undefined) body.tax_bps = tax.bps
    if (service.bps !== undefined) body.service_charge_bps = service.bps
    if (withTables) {
      body.tables = {
        prefix: form.tablePrefix.trim(),
        from: Number.parseInt(form.tableFrom, 10),
        to: Number.parseInt(form.tableTo, 10),
      }
    }

    setBusy(true)
    setProblem(null)

    platformApi
      .onboardRestaurant(token.trim(), body)
      .then((created) => {
        setBusy(false)
        setResult(created)
      })
      .catch((err: unknown) => {
        setBusy(false)
        if (!isApiError(err)) {
          setProblem('Could not reach the server. Check the API is running.')
          return
        }
        // A 404 here is not "wrong URL" -- it is the route group not being mounted because the
        // server has no platform token. Saying so is the difference between a five-second fix
        // and an afternoon.
        if (err.status === 404) {
          setProblem(
            'This server has restaurant onboarding disabled: it was started without ' +
              'TABLEX_PLATFORM_TOKEN, so the endpoint does not exist. Set it and restart the API.',
          )
          return
        }
        setProblem(err.message)
      })
  }

  if (result !== null) {
    return (
      <OnboardResult
        result={result}
        onOnboardAnother={() => {
          // The token is kept: an operator onboarding a second restaurant should not paste it
          // again. Everything identifying the first is cleared, so nothing can be resubmitted
          // by accident into a duplicate.
          setResult(null)
          setProblem(null)
          set({ name: '', slug: '', address: '', phone: '', gstNumber: '' })
          set({ upiVpa: '', upiPayeeName: '' })
          set({ ownerName: '', ownerEmail: '', ownerPassword: '' })
        }}
      />
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-display font-semibold tracking-tight">Onboard a restaurant</h1>
      <p className="mt-1.5 text-base text-muted">
        Creates the restaurant, its first owner login and its table QR codes in one step. This is an
        operator action, not a restaurant one — it needs the deployment&apos;s platform token, not a
        staff sign-in.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-4">
        <Card title="Platform token">
          <Field
            label="X-Platform-Token"
            value={token}
            onChange={setToken}
            type="password"
            autoComplete="off"
            required
            placeholder="from TABLEX_PLATFORM_TOKEN on the server"
          />
          <p className="text-xs text-muted">
            Held in this page only and forgotten on reload — it does not expire and it can create
            restaurants, so it is not stored the way a staff session is.
          </p>
        </Card>

        <Card title="Restaurant">
          <Field
            label="Name"
            value={form.name}
            onChange={(v) => set({ name: v })}
            required
            placeholder="Spice Garden"
          />
          <Field
            label="URL slug (optional)"
            value={form.slug}
            onChange={(v) => set({ slug: v })}
            placeholder="leave blank to use the name"
          />
          <p className="text-xs text-muted">
            Diner URL will be{' '}
            <strong className="font-mono">/r/{derivedSlug === '' ? '…' : derivedSlug}</strong>. This
            goes on printed signage and cannot be changed without invalidating it. The server
            normalises the final value.
          </p>
          <Field label="Address" value={form.address} onChange={(v) => set({ address: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" value={form.phone} onChange={(v) => set({ phone: v })} />
            <Field
              label="Timezone (IANA)"
              value={form.timezone}
              onChange={(v) => set({ timezone: v })}
              placeholder="Asia/Kolkata"
            />
          </div>
          <p className="text-xs text-muted">
            The timezone decides when daily order numbers roll over and what &ldquo;today&rdquo;
            means on the dashboard. It must be an IANA name — <span className="font-mono">IST</span>{' '}
            is rejected.
          </p>
        </Card>

        <Card title="Tax">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="GST (%)"
              value={form.taxPercent}
              onChange={(v) => set({ taxPercent: v })}
              numeric
            />
            <Field
              label="Service charge (%)"
              value={form.servicePercent}
              onChange={(v) => set({ servicePercent: v })}
              numeric
            />
          </div>
          <Field
            label="GST number"
            value={form.gstNumber}
            onChange={(v) => set({ gstNumber: v })}
          />
          <p className="text-xs text-muted">
            Left blank, GST defaults to 5% and the service charge to none. Typing an explicit
            <strong> 0</strong> is different: it means the restaurant charges neither.
          </p>
        </Card>

        <Card title="Payments">
          <p className="text-xs text-muted">
            New restaurants start on static UPI: a <span className="font-mono">upi://</span> QR
            built from their own account, with no gateway and no fees. It cannot confirm that money
            arrived — staff mark each payment received, exactly as with cash. Switching to a gateway
            is done later from Settings.
          </p>
          <Field
            label="UPI ID (VPA)"
            value={form.upiVpa}
            onChange={(v) => set({ upiVpa: v })}
            placeholder="restaurant@okhdfcbank"
          />
          {vpaLooksOdd ? (
            <p className="text-xs text-danger">
              That does not look like a UPI ID — they are usually name@bank. Check it before
              submitting: a wrong one sends diners&apos; money elsewhere.
            </p>
          ) : null}
          <Field
            label="Payee name shown in the diner's UPI app"
            value={form.upiPayeeName}
            onChange={(v) => set({ upiPayeeName: v })}
          />
          <p className="text-xs text-muted">
            Both are optional here. Left blank, the restaurant can still take orders and be paid at
            the counter, and a diner choosing &ldquo;Pay via QR&rdquo; is told online payment is not
            set up rather than shown a broken screen.
          </p>
        </Card>

        <Card title="Owner login">
          <Field
            label="Name"
            value={form.ownerName}
            onChange={(v) => set({ ownerName: v })}
            required
          />
          <Field
            label="Email"
            value={form.ownerEmail}
            onChange={(v) => set({ ownerEmail: v })}
            type="email"
            autoComplete="off"
            required
          />
          <Field
            label="Temporary password"
            value={form.ownerPassword}
            onChange={(v) => set({ ownerPassword: v })}
            type="password"
            autoComplete="new-password"
            required
            placeholder="at least 8 characters"
          />
          <p className="text-xs text-muted">
            Always created as an <strong>owner</strong>, because the first account has to be able to
            add the rest of the staff. The email must not already sign in to another restaurant here
            — login refuses an address that matches two rather than guessing which was meant. Hand
            this password over and have them change it from Settings.
          </p>
        </Card>

        <Card title="Tables">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withTables}
              onChange={(event) => setWithTables(event.target.checked)}
              className="h-4 w-4"
            />
            Create a numbered range of tables now
          </label>

          {withTables ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Label prefix"
                  value={form.tablePrefix}
                  onChange={(v) => set({ tablePrefix: v })}
                  placeholder="T-"
                />
                <Field
                  label="From"
                  value={form.tableFrom}
                  onChange={(v) => set({ tableFrom: v })}
                  numeric
                />
                <Field
                  label="To"
                  value={form.tableTo}
                  onChange={(v) => set({ tableTo: v })}
                  numeric
                />
              </div>
              {range.ok ? (
                <p className="text-xs text-muted">
                  {range.count} table{range.count === 1 ? '' : 's'}, labelled{' '}
                  <span className="font-mono">
                    {form.tablePrefix}
                    {form.tableFrom}
                  </span>{' '}
                  to{' '}
                  <span className="font-mono">
                    {form.tablePrefix}
                    {form.tableTo}
                  </span>
                  . Each gets its own QR code, printable from Tables afterwards.
                </p>
              ) : (
                <p className="text-xs text-danger">{range.error}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">
              The restaurant can add tables itself later. Its restaurant-level QR — the one taped to
              the counter — works with none, and lands diners on a table picker.
            </p>
          )}
        </Card>

        {problem !== null ? <Notice tone="danger">{problem}</Notice> : null}

        <div>
          <Button type="submit" variant="primary" loading={busy} loadingLabel="Onboarding…">
            Onboard restaurant
          </Button>
        </div>
      </form>
    </main>
  )
}

/**
 * The section wrapper and the text field, kept as thin local shims over the shared primitives.
 *
 * Rewriting these two rather than the fifteen call sites below is deliberate: the props are already
 * the right shape, so the whole form picks up the panel's field styling, its focus ring and its
 * label wiring without a fifteen-place edit that could quietly drop a `required` or an
 * autocomplete hint on a form that creates a tenant.
 */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <UICard className="space-y-3">
      <CardHeader title={title} />
      {children}
    </UICard>
  )
}

function Field({
  label,
  value,
  onChange,
  type,
  placeholder,
  numeric,
  required,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  placeholder?: string
  numeric?: boolean
  required?: boolean
  autoComplete?: string
}) {
  return (
    <UIField label={label} optional={!required}>
      {({ id }) => (
        <Input
          id={id}
          type={type ?? 'text'}
          value={value}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={numeric ? 'decimal' : undefined}
          numeric={numeric}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </UIField>
  )
}
