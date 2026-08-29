import { Container, Eyebrow } from '../shell'

/**
 * Price, and the pilot offer.
 *
 * This section exists because ambiguity about money is the objection that kills the conversation
 * before it starts: an owner who cannot tell whether this is ₹500 a month or ₹50,000 assumes the
 * larger number and stops reading.
 *
 * IT ALSO REPLACES THE TESTIMONIAL BLOCK, and that substitution is the point. Every reference
 * page for this design puts customer quotes here. tableX has no customers, and a fabricated quote
 * is not a placeholder -- it is the single most damaging thing that could go on this page, since
 * it is the one claim a prospect can check by asking the restaurant it names. Being early is a
 * real thing to say, and saying it plainly buys the trust that a fake quote would spend.
 *
 * The offer is a genuine one and the copy commits to it, so it must come down when it stops being
 * true. That is a one-line edit here, and DECISIONS.md D19 records why nothing invented replaced
 * it in the meantime.
 */

const INCLUDED = [
  'Your menu, entered and checked with you',
  'A printed QR card for every table',
  'The kitchen board, on any screen you already own',
  'UPI payments to the account you already use',
  'Owner and staff logins',
] as const

const NOT_NEEDED = [
  'A terminal',
  'A card scanner',
  'A POS to integrate with',
  'A setup fee',
] as const

export function Pricing() {
  return (
    <section
      aria-labelledby="pricing-h"
      id="pricing"
      className="border-t border-line py-16 md:py-24 lg:py-32"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>Pricing</Eyebrow>
            <h2
              id="pricing-h"
              className="mt-3 max-w-[16ch] font-display text-[clamp(28px,3.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.025em] text-ink"
            >
              Free while we onboard our first restaurants.
            </h2>
            <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-[1.55] text-muted">
              We are early, and we would rather have a handful of restaurants using this properly
              than a price list. You get it set up and running at no cost. In exchange you tell us
              what is wrong with it, honestly, while we are still small enough to fix it quickly.
            </p>
            <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-muted">
              No contract, no card, and no lock-in. Your menu and your order history are yours; if
              you stop using it, you take the QR cards off the tables and that is the whole exit.
            </p>
            <a
              href="#book-demo"
              className="mt-7 inline-flex min-h-tap items-center justify-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
            >
              Book a demo
            </a>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-[1.25rem] border border-line bg-surface p-6 md:p-8">
              <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-accent">
                What the pilot includes
              </h3>
              <ul className="mt-4 space-y-3">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex gap-3 text-[0.9375rem] leading-[1.5] text-ink">
                    <Tick />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-7 border-t border-line pt-6">
                <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  What you do not need to buy
                </h3>
                <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
                  {NOT_NEEDED.map((item) => (
                    <li
                      key={item}
                      className="rounded-full border border-line px-3 py-1 text-[0.8125rem] text-muted"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-[0.8125rem] leading-[1.5] text-muted">
                  You need a menu, a printer for the table cards, and a phone or tablet at the
                  counter for the kitchen board. Everything else is already in your diners&rsquo;
                  pockets.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/** A tick that is a shape, not a character: ✓ renders in whatever face the system decides. */
function Tick() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  )
}
