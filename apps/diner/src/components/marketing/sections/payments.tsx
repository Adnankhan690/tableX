import { formatINR } from '@tablex/shared'
import { QrGlyph } from '../glyphs'
import { Container, MockDescription, SectionHeader } from '../shell'

/**
 * Payments, said plainly.
 *
 * The callout below is the highest-value block on this page for a restaurant owner and it must
 * not be softened. A static UPI QR genuinely cannot confirm that money arrived — pretending
 * otherwise would be the one lie that costs a restaurant real money, and every owner reading this
 * already knows how their counter works. Naming the limitation and showing it is the same trust
 * step as cash is what makes the rest of the page believable (docs/DECISIONS.md D2).
 */

const TOTAL_MINOR = 100800

export function Payments() {
  return (
    <section
      aria-labelledby="pay-h"
      id="payments"
      className="border-t border-line py-16 md:py-24 lg:py-32"
    >
      <Container className="lg:grid lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <SectionHeader
            id="pay-h"
            eyebrow="Payments"
            title="Take payment the way your counter already does."
            lead="Pay by UPI from the seat, or settle at the counter. Both place the order the same way — the difference is only when the money moves."
          />

          <div className="mt-8 rounded-card border border-line bg-surface-sunken p-5 lg:p-6">
            <h3 className="text-[0.9375rem] font-semibold text-ink">Said plainly.</h3>
            <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-[1.62] text-muted">
              A static UPI QR cannot confirm that money arrived. The diner sees a payment reference
              and &ldquo;awaiting confirmation&rdquo;, and a staff member taps{' '}
              <em className="not-italic font-medium text-ink">Mark as paid</em> once the credit
              lands — the same trust step as cash, which is how your counter already works. tableX
              is never in the middle and takes no cut of the transfer. If you want automatic
              reconciliation, a gateway drops into the same slot without changing anything the diner
              sees.
            </p>
          </div>
        </div>

        <div className="mt-10 lg:col-span-6 lg:col-start-7 lg:mt-0">
          <PaymentCard />
        </div>
      </Container>
    </section>
  )
}

function PaymentCard() {
  return (
    <div className="rounded-[1.25rem] border border-line bg-surface p-6">
      <div aria-hidden="true">
        <div className="flex items-center gap-5">
          <QrGlyph size={88} className="shrink-0 text-ink" />
          <div className="min-w-0">
            <p className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-accent">
              {formatINR(TOTAL_MINOR)}
            </p>
            <p className="mt-2 text-[0.8125rem] text-muted">Spice Garden · Table 4</p>
            <span
              className="mt-3 inline-flex rounded-full px-2.5 py-1 text-[0.75rem] font-semibold"
              style={{
                background: 'var(--tx-tone-progress-bg)',
                color: 'var(--tx-tone-progress-fg)',
              }}
            >
              Awaiting confirmation
            </span>
          </div>
        </div>

        <div className="my-4 border-t border-line" />

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold text-ink">Pay at counter</p>
            <p className="mt-1 text-[0.8125rem] text-muted">Staff mark it paid at the counter.</p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold"
            style={{ background: 'var(--tx-tone-done-bg)', color: 'var(--tx-tone-done-fg)' }}
          >
            Order placed
          </span>
        </div>
      </div>
      <MockDescription>
        A payment screen: a UPI QR code for ₹1,008.00 at Spice Garden, Table 4, awaiting
        confirmation. Below it, the pay-at-counter option, order placed, which staff mark as paid at
        the counter.
      </MockDescription>
    </div>
  )
}
