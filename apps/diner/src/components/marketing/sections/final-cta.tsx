import { DEMO_MENU_HREF } from '@/lib/site'
import { ArrowRight } from '../glyphs'
import { Container } from '../shell'
import { BookDemoForm } from './book-demo'

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
  const hasDemo = DEMO_MENU_HREF !== ''

  return (
    <section
      aria-labelledby="cta-h"
      id="book-demo"
      className="border-t border-line py-16 md:py-24 lg:py-32"
    >
      <Container>
        <div className="mx-auto max-w-[900px] rounded-[1.25rem] border border-line bg-[linear-gradient(180deg,var(--tx-accent-soft)_0%,var(--tx-bg)_100%)] p-8 text-center md:p-12 lg:p-16">
          <h2
            id="cta-h"
            className="mx-auto max-w-[22ch] font-display text-[clamp(28px,3.2vw,42px)] font-semibold leading-[1.08] tracking-[-0.022em] text-ink"
          >
            Book a demo. We set it up with you.
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-[1.0625rem] leading-[1.55] text-muted md:text-[1.1875rem]">
            Tell us where you are and we will walk your floor through it — the menu, the table cards
            and the kitchen board — then hand it over running.
          </p>

          {/*
            The form itself, not a button that scrolls to one. This is the last thing on the page
            and the only place a prospect can act; making them travel to another section to do it
            is a step that only ever loses people.
          */}
          <div className="mx-auto mt-8 max-w-[560px]">
            <BookDemoForm />
          </div>

          {hasDemo ? (
            <div className="mt-8 border-t border-line pt-6">
              <a
                href={DEMO_MENU_HREF}
                rel="nofollow"
                className="group inline-flex min-h-tap items-center gap-1.5 text-[1.0625rem] font-medium text-ink"
              >
                Not ready to talk? Open the demo menu
                <ArrowRight
                  size={16}
                  className="transition-transform duration-150 group-hover:translate-x-0.5"
                />
              </a>
            </div>
          ) : null}

          <p className="mt-6 text-[0.8125rem] text-muted">
            Free while we onboard our first restaurants. No card, no contract.
          </p>
        </div>
      </Container>
    </section>
  )
}
