import { DEMO_MENU_HREF, PRIMARY_CTA_HREF } from '@/lib/site'
import { BoardMock } from '../board-mock'
import { ArrowRight } from '../glyphs'
import { PhoneMock } from '../phone-mock'
import { TableTent } from '../table-tent'

/**
 * The hero, and the page's LCP element.
 *
 * Exactly two accent-filled objects live here — the primary button and the phone's cart bar —
 * and they sit on a diagonal that carries the eye from the copy into the product. Accent covers
 * under 5% of the hero; a saffron this deep stops being a signal the moment it is used for
 * emphasis rather than for action.
 */

const MICRO_FACTS = [
  'No app to install',
  'No diner login',
  'UPI or pay at the counter',
  'Built to load on 3G',
] as const

export function Hero() {
  const hasDemo = DEMO_MENU_HREF !== ''

  return (
    <section aria-labelledby="hero-h" className="relative overflow-hidden border-b border-line">
      <div className="mk-grid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      {/*
        The end stop is named as var(--tx-bg), never `transparent`. Fading to transparent
        interpolates through rgba(0,0,0,0), which grey-shifts the middle of the ramp -- on a page
        whose whole argument is warmth, that is the one bug that ruins it.
      */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(52%_48%_at_60%_38%,var(--tx-accent-soft)_0%,var(--tx-bg)_72%)]"
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-[1180px] px-5 pb-16 pt-14 sm:px-8 md:pb-24 md:pt-20 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-10 lg:pb-32 lg:pt-24">
        <div className="max-w-[600px] lg:col-span-5">
          <p className="mk-rise text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-accent">
            QR table ordering · Built for Indian restaurants
          </p>

          <h1
            id="hero-h"
            className="mk-rise mt-4 max-w-[13ch] font-display text-[clamp(40px,5.6vw,72px)] font-semibold leading-[1.01] tracking-[-0.03em] text-ink"
            style={{ animationDelay: '60ms' }}
          >
            Every table takes{' '}
            <span className="relative whitespace-nowrap">
              its own order.
              <Underline />
            </span>
          </h1>

          <p
            className="mk-rise mt-5 max-w-[48ch] text-[1.0625rem] leading-[1.55] text-muted md:text-[1.1875rem]"
            style={{ animationDelay: '120ms' }}
          >
            They point a camera at the code on the table, read your whole menu, order and pay. It is
            on your kitchen screen before the phone goes back on the table.
          </p>

          <div
            className="mk-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
            style={{ animationDelay: '180ms' }}
          >
            <a
              href={PRIMARY_CTA_HREF}
              className="flex min-h-tap items-center justify-center rounded-card bg-accent px-6 text-[1.0625rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
            >
              Get your restaurant set up
            </a>
            <a
              href={hasDemo ? DEMO_MENU_HREF : '#how-it-works'}
              rel={hasDemo ? 'nofollow' : undefined}
              className="group flex min-h-tap items-center gap-1.5 px-1 text-[1.0625rem] font-medium text-ink"
            >
              {hasDemo ? 'See a live menu' : 'See how it works'}
              <ArrowRight
                size={16}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </a>
          </div>

          <ul
            className="mk-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted"
            style={{ animationDelay: '240ms' }}
          >
            {MICRO_FACTS.map((fact, i) => (
              <li key={fact} className="flex items-center gap-3">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                {fact}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-12 lg:col-span-7 lg:mt-0">
          {/* The one overlap on the page: the phone sits over the board's lower-left corner.
              One depth cue, used once, is a composition; used everywhere it is a style. */}
          <BoardMock variant="hero" className="absolute right-0 top-8 hidden w-[300px] lg:block" />
          <PhoneMock className="mk-rise relative z-10 mx-auto w-[248px] md:w-[276px] lg:ml-auto lg:mr-8 lg:w-[300px]" />
          <TableTent className="absolute -left-2 bottom-6 hidden md:block lg:left-4" />
          {/* Not decoration: this caption is what keeps a drawn mock from reading as a claim. */}
          <p className="relative mt-4 text-center text-[0.8125rem] italic text-muted lg:text-left">
            Example: a table card, and the menu it opens.
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * The saffron marker stroke under the last three words.
 *
 * Two passes, not one: the short second stroke at 55% opacity is the whole reason it reads as a
 * marker rather than as a border-bottom. The words themselves stay ink — colouring them would
 * spend the accent on emphasis, which is a budget this page keeps for actions.
 *
 * `preserveAspectRatio="none"` so the stroke stretches to whatever width the system serif
 * happens to produce, which differs per platform and must never be depended on.
 */
function Underline() {
  return (
    <svg
      className="absolute -bottom-[0.12em] left-0 h-[0.28em] w-full overflow-visible"
      viewBox="0 0 400 20"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="mk-draw"
        d="M2,14 C60,6 140,4 210,7 C280,10 340,13 398,6"
        stroke="var(--tx-accent)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        className="mk-draw"
        d="M14,19 C70,12 150,10 268,12"
        stroke="var(--tx-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  )
}
