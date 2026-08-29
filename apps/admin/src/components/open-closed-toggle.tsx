'use client'

import { isApiError } from '@tablex/api-client'
import { cn } from '@tablex/ui'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { SwitchTrack } from '@/components/ui'
import { api } from '@/lib/api'

/**
 * The "we are open" switch (docs/DECISIONS.md D18).
 *
 * Lives on the ORDER BOARD rather than on Settings, because that is the screen staff have open for
 * the whole shift and closing up is the last thing they do on it. Settings is where a manager
 * configures a restaurant; this is a floor action, and it is open to every role for the same
 * reason marking a dish sold out is -- routing it through a manager would mean orders keep
 * arriving after the kitchen has gone home.
 *
 * ASYMMETRIC ON PURPOSE. Open is the quiet state and closed is the loud one, because the dangerous
 * mistake is one-directional: a restaurant accidentally left closed is a silent outage that
 * nobody notices until a diner complains, while one accidentally left open merely takes an order
 * a human then rejects. So closed gets a banner and a red control, and open gets a quiet switch.
 */
export interface AcceptingOrdersState {
  /** Null until the server has been asked. Nothing renders on a guess. */
  accepting: boolean | null
  saving: boolean
  error: string | null
  toggle: () => void
}

/**
 * The state, held once and shared by the two pieces that show it.
 *
 * A hook rather than two self-contained components, because the switch belongs in the page header
 * and the banner belongs below it -- they cannot be one element, and two copies of this state would
 * drift the moment one of them saved.
 */
export function useAcceptingOrders(): AcceptingOrdersState {
  const { auth } = useAuth()
  const token = auth?.accessToken ?? null

  /**
   * Null until the server has been asked.
   *
   * Read from the API rather than from the login payload, which is a snapshot from whenever this
   * person signed in -- possibly yesterday, possibly before a colleague closed up. The switch has
   * to reflect the restaurant, not this session's memory of it.
   */
  const [accepting, setAccepting] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api
      .getSettings(token)
      .then((settings) => setAccepting(settings.accepting_orders))
      .catch(() => {
        /* The board is about orders; failing to read one flag must not take the screen down. */
      })
  }, [token])

  const toggle = useCallback(() => {
    if (!token || accepting === null || saving) return

    const next = !accepting
    setSaving(true)
    setError(null)
    // Optimistic, then corrected from the response. The switch has to feel instant -- it is tapped
    // while locking up, usually one-handed.
    setAccepting(next)

    api
      .setAcceptingOrders(token, next)
      .then((settings) => setAccepting(settings.accepting_orders))
      .catch((err: unknown) => {
        setAccepting(!next)
        setError(isApiError(err) ? err.message : 'Could not change this. Try again.')
      })
      .finally(() => setSaving(false))
  }, [accepting, saving, token])

  return { accepting, saving, error, toggle }
}

/**
 * The switch itself.
 *
 * ONE ELEMENT, RENDERED ONCE, and both halves of that matter.
 *
 * It used to sit in PageHeader's `actions` slot on the order board, and that header carries
 * `hidden sm:flex` -- so below 640px it was display:none, while the closed-state banner outside it
 * kept its own Reopen button. A phone could REOPEN a restaurant but never CLOSE one. Invisible on a
 * laptop.
 *
 * The reflex fix is a second copy behind `sm:hidden`, and app-shell.tsx already argues against
 * exactly that for the sign-out button: it doubles the tab stops, hands assistive technology two
 * identically-named controls where the page has one action, and makes any test targeting it
 * ambiguous. So it moved instead -- into the shell's account footer, which already performs that
 * movement, and where it is now reachable from every page at every width.
 */
export function OpenClosedSwitch({
  state,
  className,
}: {
  state: AcceptingOrdersState
  className?: string
}) {
  const { accepting, saving, toggle } = state

  // Nothing until the real value is known. A switch that guesses "open" and corrects itself a
  // moment later is worse than a brief gap, because the wrong answer here reads as fact.
  if (accepting === null) return null

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      // A real switch to assistive technology as well as visually: it reports state through
      // aria-checked rather than through a label that changes underneath it.
      role="switch"
      aria-checked={accepting}
      // Contains the visible word, so voice control still matches what is on screen (WCAG 2.5.3),
      // while giving a screen reader the context that "Open" on its own does not carry.
      aria-label="Open for orders"
      className={cn(
        /*
          As small as it can be while still saying what it is. It shares the shell's top bar with
          the restaurant's name and Sign out, and that bar must never wrap -- so every pixel here
          comes straight out of the name (see app-shell.tsx).

          The LABEL STAYS. Dropping it below `sm` would buy another ~40px, and it was tempting,
          but an unlabelled toggle beside "Sign out" gives a manager no way to know what it does
          before pressing it -- and what it does is stop the restaurant taking orders.
        */
        'flex min-h-tap-sm shrink-0 items-center gap-1.5 rounded-control border px-2',
        'text-sm font-medium transition-colors disabled:opacity-60 sm:min-h-tap',
        accepting
          ? 'border-line-strong bg-surface text-ink hover:bg-surface-sunken'
          : 'border-danger-line bg-danger-soft text-ink hover:bg-danger-soft',
        className,
      )}
    >
      {/*
        SHORT, AND IT DOES NOT CHANGE.

        "Open" rather than "Taking orders" because the long version was the widest thing in the
        shell's top bar and pushed the whole account block onto a second row -- and "open" is the
        word a restaurant actually uses about itself.

        It stays constant rather than flipping to "Closed", which is the convention every platform
        switch follows: the label names the thing, the track carries the state. A label that flips
        is redundant with the track at best, and at worst reads as an instruction -- "Closed" is as
        easily press-this-to-close as we-are-closed.
      */}
      Open
      <SwitchTrack on={accepting} tone="success" size="sm" />
    </button>
  )
}

/**
 * The consequence, said once, across the top of whatever page is open.
 *
 * Carries NO control of its own. A switch plus a Reopen button is two controls for one action --
 * the same duplication the switch itself was moved to avoid, rotated ninety degrees. This explains;
 * the switch acts.
 *
 * Shown on every page because the asymmetry is real: a restaurant accidentally left closed is a
 * silent outage whose victims are not in the room to complain, and the person who can fix it may
 * well be looking at the menu editor rather than the board.
 */
export function ClosedNotice({ state }: { state: AcceptingOrdersState }) {
  const { accepting, error } = state
  if (accepting === null) return null
  if (accepting && error === null) return null

  return (
    <div className="no-print border-b border-danger-line bg-danger-soft px-4 py-2.5">
      {!accepting ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-danger"
            strokeWidth={2}
          />
          <span>
            <span className="font-semibold">Not taking orders.</span> Diners can still read the
            menu, but placing an order is refused. Nothing new will reach the board until you switch
            it back on.
          </span>
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
