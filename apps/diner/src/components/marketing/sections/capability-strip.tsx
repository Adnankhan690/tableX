/**
 * The stat strip, with the fabrication removed.
 *
 * Every reference page for this design puts customer counts here — "3,00,000+ restaurants",
 * "trusted by 30,000+ developers". tableX is new and has none, and inventing them is the one
 * thing this page may not do. So the slot keeps its structural job (four hard numbers, read in
 * two seconds, that make the product feel definite) and changes what the numbers are ABOUT: they
 * are facts about how the software works, each traceable to a file in this repo.
 *
 * The footnote is the point, not an apology. A buyer who reads it learns we know the difference
 * between proof and decoration, which is worth more here than a number we made up.
 */

const CAPABILITIES = [
  {
    numeral: '0',
    label: 'apps to install',
    body: 'It opens in the browser the diner already has. No account, no OTP, no password.',
  },
  {
    numeral: '1',
    label: 'scan',
    body: 'The table, the session and the whole menu arrive in a single response.',
  },
  {
    numeral: '8',
    label: 'order states',
    body: 'One state machine the server enforces. No order sits in a state nobody owns.',
  },
  {
    numeral: '12 h',
    label: 'table session',
    body: 'The table stays theirs for the sitting, with nothing to log in to.',
  },
] as const

export function CapabilityStrip() {
  return (
    <section aria-labelledby="cap-h" className="border-b border-line bg-surface-sunken">
      <h2 id="cap-h" className="sr-only">
        What that means in practice
      </h2>
      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-2 divide-x divide-y divide-line px-0 sm:px-8 lg:grid-cols-4 lg:divide-y-0 lg:px-10">
        {CAPABILITIES.map((cap, i) => (
          <div
            key={cap.label}
            className="mk-reveal p-5 lg:px-6 lg:py-10"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-accent">
              {cap.numeral}
            </p>
            <p className="mt-2 text-[0.9375rem] font-semibold text-ink">{cap.label}</p>
            <p className="mt-2 text-[0.8125rem] leading-[1.5] text-muted">{cap.body}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-[62ch] px-5 pb-8 pt-6 text-center text-[0.8125rem] text-muted">
        These are facts about how the product works, not customer numbers.
      </p>
    </section>
  )
}
