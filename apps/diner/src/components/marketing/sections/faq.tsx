import { Container, SectionHeader } from '../shell'

/**
 * The FAQ, with zero JavaScript.
 *
 * Native `<details>`, not a React disclosure. It is keyboard-operable, screen-reader-correct and
 * findable by the browser's own in-page search before a single byte of JS arrives — and adding
 * `role="button"` or `aria-expanded` to a summary makes it worse, not better, by overriding the
 * semantics the element already has. No height animation, because a details element's height is
 * not animatable without measuring it in JS, and a janky reveal is worse than an instant one.
 *
 * These eight are the questions a restaurant owner actually asks, and every answer is one this
 * repo can back. Where the honest answer is a limitation — order editing is not supported, a
 * gateway is not required, a static UPI QR cannot self-confirm — it says so.
 */

const FAQS = [
  {
    q: 'Do diners need to install anything, or make an account?',
    a: 'No, and no. The QR opens a normal web page in whatever browser is already on their phone. There is no app, no sign-up, no OTP and no password anywhere in the diner flow — scanning the code is the sign-in, and the session lasts the sitting.',
  },
  {
    q: 'What do we need to buy?',
    a: 'Nothing beyond a printer and something to mount the codes on. tableX is a website on both sides: the diner uses their own phone, and you run the floor from a phone, a tablet or the laptop at your counter. No terminal, no scanner, no POS box.',
  },
  {
    q: 'Our restaurant wifi is unreliable. Does it break?',
    a: 'It degrades rather than breaks. The whole menu arrives in one request, so browsing is not chatty, and the board falls back to polling every few seconds on its own. Nothing important is delivered only over the live channel, so a dropped frame cannot leave the diner and the kitchen disagreeing.',
  },
  {
    q: 'Can a diner change or cancel an order?',
    a: 'Cancel, yes — while the kitchen has not accepted it. After that the control is replaced with “ask staff”, because the food may already be on. Editing a placed order is deliberately not supported: a second order is instant, and your staff can strike a single line off a ticket with the total re-priced.',
  },
  {
    q: 'Can someone order onto our table without being here?',
    a: 'The code is a random 32-character token, not “table 7” — there is nothing to guess and nothing that reveals how many tables you have. If a sticker gets photographed and posted somewhere, you regenerate that one table’s code and reprint one card, not the floor.',
  },
  {
    q: 'What if a table’s QR sticker gets peeled off?',
    a: 'A restaurant-level code taped to the counter still works — the diner picks their table from a list. It is the recovery path that keeps you taking orders on a bad night.',
  },
  {
    q: 'What happens if nobody accepts an order?',
    a: 'It stays on the board as New and keeps announcing itself. The diner’s screen tells them it is taking longer than usual after a few minutes, and after twenty that the fastest thing is to speak to someone. Your dashboard reports the day’s average time to accept, so a slow shift is visible rather than anecdotal.',
  },
  {
    q: 'Do I need a payment gateway?',
    a: 'No. Start with the UPI ID you already use. Add a gateway when you want automatic reconciliation; the diner’s flow does not change.',
  },
] as const

export function Faq() {
  return (
    <section
      aria-labelledby="faq-h"
      id="faq"
      className="border-t border-line bg-surface-sunken py-16 md:py-24 lg:py-32"
    >
      <Container className="lg:grid lg:grid-cols-12 lg:gap-10">
        <SectionHeader
          id="faq-h"
          eyebrow="Questions"
          title="The things owners ask first."
          className="lg:col-span-4 lg:sticky lg:top-28 lg:self-start"
        />

        <div className="mt-10 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface lg:col-span-7 lg:col-start-6 lg:mt-0">
          {FAQS.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[1.0625rem] font-medium text-ink group-open:bg-accent-soft [&::-webkit-details-marker]:hidden">
                {item.q}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="shrink-0 text-accent transition-transform duration-200 group-open:rotate-45"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </summary>
              <p className="px-5 pb-5 text-[0.9375rem] leading-[1.62] text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}
