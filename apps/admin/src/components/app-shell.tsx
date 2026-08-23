'use client'

import { cn } from '@tablex/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/components/auth-provider'

/** Inline SVG only -- no icon library ships here (see package.json). */
const ICONS: Record<string, ReactNode> = {
  orders: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  menu: (
    <>
      <path d="M6 4v16M6 4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 4v16M14 4h4a2 2 0 0 1 0 8h-4" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  tables: (
    <>
      <rect x="3.5" y="4.5" width="17" height="7" rx="1.5" strokeWidth="2" />
      <path d="M7 11.5V19M17 11.5V19" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" strokeWidth="2" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.5" strokeWidth="2" />
      <path
        d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M18 20a5 5 0 0 0-2-4"
        strokeWidth="2"
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

/**
 * The authenticated chrome.
 *
 * A left rail on a laptop, a top bar on a tablet in portrait. `no-print` because the table-QR
 * sheet has to print without it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { auth, logout } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <header className="no-print flex shrink-0 flex-col border-b border-line bg-surface md:w-56 md:border-b-0 md:border-r">
        <div className="min-w-0 px-4 py-3">
          <p className="truncate text-sm font-semibold">{auth?.restaurant.name ?? 'tableX'}</p>
          <p className="truncate text-xs text-muted">
            {auth ? `${auth.staff.name} · ${auth.staff.role}` : ''}
          </p>
        </div>

        {/* Horizontal scroll on narrow screens rather than a hamburger: five destinations fit,
            and a menu behind a tap is one more tap during service. */}
        <nav className="scroll-x-contain flex gap-1 px-2 pb-2 md:flex-col md:px-2 md:pb-0">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap shrink-0 items-center gap-2 rounded-card px-3 text-sm font-medium',
                  active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-sunken',
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className="h-4 w-4 shrink-0"
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
          ONE sign-out button, not one per breakpoint.
          Rendering a second copy behind `md:hidden` is the usual way to move a control between
          responsive layouts, and it is wrong: it doubles the tab stops, gives assistive
          technology two identically-named buttons where the page has one action, and makes any
          test that targets it ambiguous. `mt-auto` puts it at the end of the rail on a laptop
          and directly under the nav on a tablet, which is where it belongs in both.
        */}
        <button
          type="button"
          onClick={logout}
          className="mt-auto px-4 py-3 text-left text-xs font-medium text-muted underline"
        >
          Sign out
        </button>
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
