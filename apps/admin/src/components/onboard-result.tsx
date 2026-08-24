'use client'

import type { OnboardRestaurantResponse } from '@tablex/shared'

/**
 * The handover screen, shown once onboarding succeeds.
 *
 * Separated from the form because it is the deliverable rather than a confirmation. Everything a
 * restaurant needs to start taking orders is on it, and the operator is expected to copy it
 * somewhere — so it shows the URLs in full rather than hiding them behind links, and it says
 * plainly what is still missing (a menu).
 */
export function OnboardResult({
  result,
  onOnboardAnother,
}: {
  result: OnboardRestaurantResponse
  onOnboardAnother: () => void
}) {
  const { restaurant, owner, tables, diner_url, admin_url } = result

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold">{restaurant.name} is onboarded</h1>
      <p className="mt-1 text-sm text-muted">
        Created as <span className="font-mono">{restaurant.uid}</span>, status{' '}
        <strong>{restaurant.status}</strong>.
      </p>

      <section className="mt-6 space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Hand this to the restaurant
        </h2>
        <Row label="Sign in at" value={admin_url ?? 'the admin panel for this deployment'} />
        <Row label="Email" value={owner.email} />
        <p className="text-xs text-muted">
          The password is the one you typed — it is deliberately not repeated here, and the server
          never returns it. Ask them to change it from Settings after their first sign-in.
        </p>
        <Row label="Diner page" value={diner_url} />
        <p className="text-xs text-muted">
          That is the restaurant-level QR target: it lands a diner on a table picker, and it works
          even before any table sticker is printed.
        </p>
      </section>

      <section className="mt-4 space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Configuration applied
        </h2>
        <Row label="Slug" value={`/r/${restaurant.slug}`} />
        <Row label="Timezone" value={restaurant.timezone} />
        <Row label="GST" value={`${(restaurant.tax_bps / 100).toString()}%`} />
        <Row
          label="Service charge"
          value={
            restaurant.service_charge_bps === 0
              ? 'none'
              : `${(restaurant.service_charge_bps / 100).toString()}%`
          }
        />
        <Row label="Payments" value={restaurant.payment_provider} />
        {restaurant.payment_provider === 'upi_static' ? (
          <p className="text-xs text-muted">
            Static UPI cannot confirm that money arrived — a staff member marks each payment
            received, exactly as with cash. Tell the owner this before they expect orders to settle
            themselves.
          </p>
        ) : null}
      </section>

      <section className="mt-4 space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {tables.length === 0 ? 'Tables' : `${tables.length} tables created`}
        </h2>

        {tables.length === 0 ? (
          <p className="text-xs text-muted">
            None yet. The owner adds them from Tables, and each one gets its own QR code there.
          </p>
        ) : (
          <>
            {/* Its own scroll container: a QR URL is long, and letting it widen the page would
                make the whole handover scroll sideways on a laptop. */}
            <div className="scroll-x-contain overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Table</th>
                    <th className="py-1 font-medium">Scan URL</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((row) => (
                    <tr key={row.uid} className="border-t border-line">
                      <td className="py-1 pr-3 font-mono">{row.label}</td>
                      <td className="py-1 font-mono break-all">{row.qr_url}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              Printable QR codes are on the owner&apos;s Tables screen. Each URL is a capability —
              possession of one authorises ordering at that table — so treat this list as sensitive,
              and rotate a code from Tables if one leaks.
            </p>
          </>
        )}
      </section>

      <section className="mt-4 rounded-card border border-line bg-surface-sunken p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          What is missing
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          <strong>There is no menu yet.</strong> The diner page will render an empty one until the
          owner adds categories and items from the Menu screen. That is expected for a new
          restaurant, not a fault — but it does mean nobody can order until they do it.
        </p>
      </section>

      <div className="mt-6">
        <button
          type="button"
          onClick={onOnboardAnother}
          className="min-h-tap rounded-card border border-line bg-surface px-5 text-sm font-semibold"
        >
          Onboard another
        </button>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="font-mono text-xs break-all">{value}</span>
    </div>
  )
}
