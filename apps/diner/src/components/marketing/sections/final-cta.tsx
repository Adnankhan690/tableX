import { CONTACT_MAILTO, DEMO_MENU_HREF } from '@/lib/site'
import { ArrowRight } from '../glyphs'
import { Container } from '../shell'

/**
 * The closing call to action, and the one centred block on a page that is otherwise
 * axis-aligned left — which is what makes it read as an ending rather than as another section.
 *
 * NEVER "Sign up free", "Start your free trial" or "Create your account". D14 rejected public
 * self-serve signup outright and there is no endpoint behind any of those words; a button that
 * goes nowhere on the page whose subject is reliability is a self-inflicted wound. And NEVER link
 * admin.tabley.in/onboard — it is an operator console gated on TABLEX_PLATFORM_TOKEN, and linking
 * it publicly turns a deliberate trust boundary into a password prompt on the open internet.
 */
export function FinalCta() {
  const hasContact = CONTACT_MAILTO !== ''
  const hasDemo = DEMO_MENU_HREF !== ''

  return (
    <section
      aria-labelledby="cta-h"
      id="get-set-up"
      className="border-t border-line py-16 md:py-24 lg:py-32"
    >
      <Container>
        <div className="mx-auto max-w-[900px] rounded-[1.25rem] border border-line bg-[linear-gradient(180deg,var(--tx-accent-soft)_0%,var(--tx-bg)_100%)] p-8 text-center md:p-12 lg:p-16">
          <h2
            id="cta-h"
            className="mx-auto max-w-[22ch] font-display text-[clamp(28px,3.2vw,42px)] font-semibold leading-[1.08] tracking-[-0.022em] text-ink"
          >
            Getting set up is a conversation, not a signup form.
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-[1.0625rem] leading-[1.55] text-muted md:text-[1.1875rem]">
            We create the restaurant, its first owner login and its floor of tables together, then
            hand it over. Tell us the name of the place and how many tables it has.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a
              href={hasContact ? CONTACT_MAILTO : '#how-it-works'}
              className="flex min-h-tap items-center justify-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
            >
              {hasContact ? 'Email us about your restaurant' : 'See how it works'}
            </a>
            {hasDemo ? (
              <a
                href={DEMO_MENU_HREF}
                rel="nofollow"
                className="group flex min-h-tap items-center gap-1.5 px-1 text-[1.0625rem] font-medium text-ink"
              >
                See a live menu
                <ArrowRight
                  size={16}
                  className="transition-transform duration-150 group-hover:translate-x-0.5"
                />
              </a>
            ) : null}
          </div>

          <p className="mt-6 text-[0.8125rem] text-muted">
            You will need a menu and a printer. Nothing else.
          </p>
        </div>
      </Container>
    </section>
  )
}
