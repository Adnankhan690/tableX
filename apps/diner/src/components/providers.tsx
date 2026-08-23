'use client'

import type { MenuItemView } from '@tablex/shared'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  addLine as addLineTo,
  type Cart,
  cartCount,
  clearCart as clearStoredCart,
  readCart,
  removeLine as removeLineFrom,
  setNote as setNoteOn,
  setQuantity as setQuantityOn,
  writeCart,
} from '@/lib/cart'
import {
  clearSession as clearStoredSession,
  type GuestSession,
  isExpired,
  readSession,
  writeSession,
} from '@/lib/session'

interface SessionValue {
  session: GuestSession | null
  /** False until the first effect has read localStorage; see the note in SessionProvider. */
  hydrated: boolean
  expired: boolean
  setSession: (session: GuestSession) => void
  clear: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * Holds the guest session (docs/DECISIONS.md D5).
 *
 * localStorage is read in an effect, never during render. Reading it in render would produce
 * different HTML on the server (where storage does not exist) than on the client, and React
 * responds to that mismatch by discarding the server HTML -- which shows the diner a flash of
 * empty page on the slow connection this app exists to be fast on.
 *
 * `hydrated` is the consequence and has to be honoured by consumers: on the first render
 * `session` is null even for a diner who has one, so a screen that redirects on
 * `!session` alone will bounce every returning diner to the "scan again" page. Wait for
 * `hydrated` before deciding anything.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<GuestSession | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setSessionState(readSession())
    setHydrated(true)
  }, [])

  const setSession = useCallback((next: GuestSession) => {
    writeSession(next)
    setSessionState(next)
  }, [])

  const clear = useCallback(() => {
    clearStoredSession()
    setSessionState(null)
  }, [])

  const value = useMemo<SessionValue>(
    () => ({
      session,
      hydrated,
      // Recomputed on every render rather than memoised on a timer: it is only read at
      // decision points, and a stale `false` would let a diner start an order on a dead token.
      expired: session !== null && isExpired(session),
      setSession,
      clear,
    }),
    [session, hydrated, setSession, clear],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession must be used inside <SessionProvider>')
  }
  return value
}

interface CartValue {
  cart: Cart | null
  count: number
  add: (item: MenuItemView) => void
  setQuantity: (menuItemUid: string, quantity: number) => void
  remove: (menuItemUid: string) => void
  setNote: (menuItemUid: string, note: string) => void
  clear: () => void
}

const CartContext = createContext<CartValue | null>(null)

/**
 * Holds the cart for the current table.
 *
 * Re-reads from storage whenever the table changes, which is what stops a diner who moved
 * tables from inheriting the previous table's order. `cart` is null until a table is known,
 * so callers can distinguish "no table yet" from "empty cart" -- the first should show
 * nothing, the second should show an empty-cart screen.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { session, hydrated } = useSession()
  const tableUid = session?.tableUid ?? null

  const [cart, setCart] = useState<Cart | null>(null)

  useEffect(() => {
    if (!hydrated) return
    setCart(tableUid ? readCart(tableUid) : null)
  }, [tableUid, hydrated])

  /**
   * Applies a pure transform and persists the result.
   *
   * Persisting inside the state updater keeps the write and the render from disagreeing: a
   * separate effect watching `cart` would write one render late, so a diner who taps "+" and
   * immediately backgrounds the app could lose that tap.
   */
  const mutate = useCallback((transform: (current: Cart) => Cart) => {
    setCart((current) => {
      if (current === null) return current
      const next = transform(current)
      writeCart(next)
      return next
    })
  }, [])

  const value = useMemo<CartValue>(
    () => ({
      cart,
      count: cart ? cartCount(cart) : 0,
      add: (item) => mutate((current) => addLineTo(current, item)),
      setQuantity: (uid, quantity) => mutate((current) => setQuantityOn(current, uid, quantity)),
      remove: (uid) => mutate((current) => removeLineFrom(current, uid)),
      setNote: (uid, note) => mutate((current) => setNoteOn(current, uid, note)),
      clear: () => {
        if (tableUid) clearStoredCart(tableUid)
        setCart(tableUid ? { tableUid, lines: [] } : null)
      },
    }),
    [cart, mutate, tableUid],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const value = useContext(CartContext)
  if (value === null) {
    throw new Error('useCart must be used inside <CartProvider>')
  }
  return value
}

/** The provider stack, so layout.tsx does not have to know the nesting order. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CartProvider>{children}</CartProvider>
    </SessionProvider>
  )
}
