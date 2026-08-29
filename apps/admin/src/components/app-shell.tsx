'use client'

import { cn } from '@tablex/ui'
import {
  ClipboardList,
  type LucideIcon,
  Settings,
  Star,
  Table2,
  Users,
  UtensilsCrossed,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/components/auth-provider'
import { ClosedNotice, OpenClosedSwitch, useAcceptingOrders } from '@/components/open-closed-toggle'
import { Button } from '@/components/ui'

const NAV: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/menu', label: 'Menu', icon: UtensilsCrossed },
  // Directly after Menu, because that is what it is about: the reviews screen answers "which
  // dish is failing", and a manager arrives at it from the menu rather than from the floor.
  { href: '/reviews', label: 'Reviews', icon: Star },
  { href: '/tables', label: 'Tables', icon: Table2 },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/staff', label: 'Staff', icon: Users },
]

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
  /**
   * Held by the shell rather than by a page, so there is ONE fetch and ONE source of truth for it.
   *
   * It used to live on the order board, which meant the switch existed only while that page was
   * open. It is restaurant-level state -- as global as the restaurant's name in the corner -- and a
   * manager on the Menu page has the same reason to close up as one on Orders.
   */
  const acceptingOrders = useAcceptingOrders()
  const restaurant = auth?.restaurant.name ?? 'tableX'

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <header className="no-print sticky top-0 z-30 flex shrink-0 flex-wrap items-center border-b border-line bg-surface lg:h-dvh lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-b-0 lg:border-r">
        {/* Brand. The monogram gives the panel an identity at a glance and, on the tablet's top
            bar, keeps the restaurant name from being the widest thing in a 44px strip. */}
        {/*
          `min-w-0`, deliberately, which means this bar NEVER WRAPS.

          A flex item with no floor shrinks rather than pushing its neighbours onto a second line,
          so the brand gives up width to the switch and Sign out and the three stay on one row at
          every size. The cost is that a long restaurant name truncates on a narrow phone, and that
          is the trade being made on purpose: two rows of chrome above a kitchen board is worse
          than an abbreviated name, and the monogram carries identity when the text runs out.

          It follows that anything added to this row is taken straight out of the name. Measure at
          360px before adding to it.
        */}
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 lg:flex-none">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent text-xs font-semibold text-accent-ink"
          >
            {initials(restaurant)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold leading-tight">
              {restaurant}
            </span>
            <span className="block truncate text-xs leading-tight text-muted">
              Restaurant admin
            </span>
          </span>
        </div>

        {/*
          THE BRAND IS `min-w-0 flex-1`, so everything sharing this row eats into the restaurant's
          name. Adding the open/close switch with its original "Taking orders" label truncated
          "Spice Garden" to "Spice G…" at 390px; shortening the label to "Open" bought back enough
          width for all three to sit on one line. Anything else added here needs checking at 390px
          against the name, which is the one element identifying which restaurant you are in.
        */}

        {/* Horizontal scroll on the tablet bar rather than a hamburger: five destinations fit, and
            a menu behind a tap is one more tap during service. */}
        <nav
          aria-label="Sections"
          className="scroll-x-contain scrollbar-none order-3 flex w-full gap-1 border-t border-divider px-2 py-2 lg:order-2 lg:w-auto lg:flex-col lg:overflow-visible"
        >
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
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
                <Icon
                  aria-hidden="true"
                  className="h-[18px] w-[18px] shrink-0"
                  strokeWidth={1.75}
                />
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
            {/*
              Beside the account, so it inherits the movement the footer already performs: on the
              tablet's top bar it sits next to Sign out, and in the laptop rail it stacks above it.
              One element, repositioned by `order` and `flex-wrap` -- never a second copy behind a
              breakpoint, for the reasons argued on the sign-out button above.
            */}
            <OpenClosedSwitch
              state={acceptingOrders}
              className="lg:mb-2 lg:w-full lg:justify-between"
            />

            <Button size="sm" onClick={logout} className="lg:w-full lg:justify-start">
              Sign out
            </Button>
          </div>
        ) : null}
      </header>

      <div className="min-w-0 flex-1">
        {/*
          The loud half of the switch, on every page rather than only on the board.

          A restaurant accidentally left closed is a silent outage whose victims are not in the room
          to complain, and the person who can fix it may well be looking at the menu editor.
        */}
        <ClosedNotice state={acceptingOrders} />
        {children}
      </div>
    </div>
  )
}
