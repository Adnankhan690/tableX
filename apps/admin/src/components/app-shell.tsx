'use client'

import { cn } from '@tablex/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/components/auth-provider'
import { Button } from '@/components/ui'

/** Inline SVG only -- no icon library ships here (see package.json). */
const ICONS: Record<string, ReactNode> = {
  orders: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" strokeWidth="1.75" />
      <path d="M8 9h8M8 13h8M8 17h4" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  menu: (
    <>
      <path
        d="M6 4v16M6 4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M16 4v16M14 4h4a2 2 0 0 1 0 8h-4" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  tables: (
    <>
      <rect x="3.5" y="4.5" width="17" height="7" rx="1.5" strokeWidth="1.75" />
      <path d="M7 11.5V19M17 11.5V19" strokeWidth="1.75" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" strokeWidth="1.75" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.5" strokeWidth="1.75" />
      <path
        d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M18 20a5 5 0 0 0-2-4"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </>
  ),
}

const NAV = [
  { href: '/orders', label: 'Orders', icon: 'orders' },
  { href: '/menu', label: 'Menu', icon: 'menu' },
  { href: '/tables', label: 'Tables', icon: 'tables' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
  { href: '/staff', label: 'Staff', icon: 'staff' },
] as const

/** The restaurant's initials, as a stand-in for a logo nobody has uploaded. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'TX'
  const first = words[0]?.[0] ?? ''
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : (words[0]?.[1] ?? '')
  return (first + second).toUpperCase()
}

/**
 * The authenticated chrome.
 *
 * A left rail on a laptop, a top bar on a tablet in portrait -- and the breakpoint is now `lg`
 * (1024px), not `md`. At `md` the 224px rail was still showing at the declared 820x1180 tablet
 * target, taking 27% of the width from the board it exists to navigate to.
 *
 * The rail is `sticky h-dvh`, which is what makes the account footer's `mt-auto` resolve against
 * the VIEWPORT rather than the document. It used to resolve against the document, so on the Menu
 * page -- 8,500px tall at production scale -- the only sign-out control sat 1,500px below the
 * fold. Whether staff could hand over the till depended on how many dishes the restaurant sold.
 *
 * `no-print` because the table-QR sheet has to print without it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { auth, logout } = useAuth()
  const restaurant = auth?.restaurant.name ?? 'tableX'

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <header className="no-print sticky top-0 z-30 flex shrink-0 flex-wrap items-center border-b border-line bg-surface lg:h-dvh lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-b-0 lg:border-r">
        {/* Brand. The monogram gives the panel an identity at a glance and, on the tablet's top
            bar, keeps the restaurant name from being the widest thing in a 44px strip. */}
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 lg:flex-none">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent text-xs font-semibold text-accent-ink"
          >
            {initials(restaurant)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold leading-tight">
              {restaurant}
            </span>
            <span className="block truncate text-xs leading-tight text-muted">
              Restaurant admin
            </span>
          </span>
        </div>

        {/* Horizontal scroll on the tablet bar rather than a hamburger: five destinations fit, and
            a menu behind a tap is one more tap during service. */}
        <nav
          aria-label="Sections"
          className="scroll-x-contain scrollbar-none order-3 flex w-full gap-1 border-t border-divider px-2 py-2 lg:order-2 lg:w-auto lg:flex-col lg:overflow-visible"
        >
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap shrink-0 items-center gap-2.5 rounded-control px-3 text-base font-medium',
                  'transition-colors duration-100',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className="h-[18px] w-[18px] shrink-0"
                  aria-hidden="true"
                >
                  {ICONS[item.icon]}
                </svg>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/*
          The account footer.

          ONE sign-out button, and it MOVES rather than duplicating: `order` plus `flex-wrap` put
          it beside the brand on the tablet's top bar and at the foot of the laptop rail. Rendering
          a second copy behind `lg:hidden` is the usual way to do this and it is wrong -- it doubles
          the tab stops, gives assistive technology two identically-named buttons where the page has
          one action, and makes any test that targets it ambiguous.

          It is a real control now rather than 12px underlined text. Signing out is the handover
          action on a shared counter laptop -- shift change, or a manager stepping away from an
          owner-privileged session -- and it was the smallest text in the panel, parked in the one
          corner that browser download bars and OS gesture bars occupy.

          `mt-auto` only bites in the rail's column layout, and it resolves against the viewport
          because the rail is `lg:h-dvh` and sticky. Before, it resolved against the document: on
          the Menu page -- 8,500px tall at production scale -- the only sign-out sat 1,500px below
          the fold, so whether staff could hand over the till depended on how many dishes the
          restaurant sold.
        */}
        {auth ? (
          <div className="order-2 flex shrink-0 items-center gap-2 px-3 py-2 lg:order-3 lg:mt-auto lg:block lg:border-t lg:border-divider lg:p-3">
            <span className="hidden min-w-0 sm:block lg:mb-2 lg:block">
              <span className="block truncate px-1 text-sm font-medium leading-tight">
                {auth.staff.name}
              </span>
              <span className="block truncate px-1 text-xs capitalize leading-tight text-muted">
                {auth.staff.role}
              </span>
            </span>
            <Button size="sm" onClick={logout} className="lg:w-full lg:justify-start">
              Sign out
            </Button>
          </div>
        ) : null}
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
