import Link from 'next/link'
import { ADMIN_BASE_URL } from '@/lib/site'
import { PlateMark } from './glyphs'

/**
 * The sticky site header.
 *
 * NO HAMBURGER, deliberately. Every target is an in-page anchor on a short page, so a menu
 * button would be a JS toggle — this tree's second client component — to hide five links that
 * the page scrolls past anyway. On a phone the header is the wordmark and one button: ONE
 * element that changes across the breakpoint, never two behind a `sm:hidden` / `hidden sm:block`
 * pair, which is the rule docs/CONTRIBUTING.md states.
 */

const NAV = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#the-menu', label: 'The menu' },
  { href: '#reliability', label: 'Reliability' },
  { href: '#payments', label: 'Payments' },
  { href: '#faq', label: 'FAQ' },
] as const

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center gap-4 px-5 sm:px-8 lg:h-[4.5rem] lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <PlateMark size={22} />
          <span className="font-display text-[1.35rem] font-semibold tracking-[-0.015em] text-ink">
            tabley
          </span>
        </Link>

        <nav aria-label="Sections" className="hidden flex-1 justify-center gap-8 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-1 py-3 text-[0.9375rem] text-muted transition-colors hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={ADMIN_BASE_URL}
            className="hidden text-[0.9375rem] text-muted transition-colors hover:text-ink sm:block"
          >
            Staff sign in
          </a>
          <a
            href="#get-set-up"
            className="flex min-h-tap items-center rounded-card bg-accent px-4 text-[0.9375rem] font-semibold text-accent-ink transition-opacity active:opacity-80"
          >
            Get set up
          </a>
        </div>
      </div>
    </header>
  )
}
