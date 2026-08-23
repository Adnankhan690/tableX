'use client'

import { isApiError } from '@tablex/api-client'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from '@/lib/api'
import { type AdminAuth, clearAuth, isExpiring, readAuth, writeAuth } from '@/lib/auth'

interface AuthValue {
  auth: AdminAuth | null
  /** False until localStorage has been read; see the note in AuthProvider. */
  hydrated: boolean
  /** The access token, refreshed if it was about to expire. Null when signed out. */
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /**
   * Awaits a fresh access token, refreshing if needed. Call this rather than reading `token`
   * before a request, so a long-idle tab does not fire with a dead token.
   */
  getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [auth, setAuth] = useState<AdminAuth | null>(null)
  const [hydrated, setHydrated] = useState(false)

  /**
   * Guards against a refresh storm.
   *
   * Several components can discover an expiring token in the same tick -- the order board, the
   * stats strip and a stream reconnect all fire together. Without this they would each start
   * their own refresh, and the server would see a burst of them. Holding the in-flight promise
   * makes concurrent callers share one request.
   */
  const refreshing = useRef<Promise<string | null> | null>(null)

  useEffect(() => {
    setAuth(readAuth())
    setHydrated(true)
  }, [])

  const signOut = useCallback(() => {
    clearAuth()
    setAuth(null)
    router.replace('/login')
  }, [router])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login({ email, password })
    const next: AdminAuth = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_at,
      staff: result.staff,
      restaurant: result.restaurant,
    }
    writeAuth(next)
    setAuth(next)
  }, [])

  const getToken = useCallback(async (): Promise<string | null> => {
    const current = readAuth()
    if (current === null) return null
    if (!isExpiring(current)) return current.accessToken

    // Join the in-flight refresh rather than starting a second one.
    if (refreshing.current !== null) return refreshing.current

    /**
     * Exactly ONE attempt, never a loop. An expired or revoked refresh token fails every time,
     * and retrying it turns a signed-out session into a request storm against the login path.
     * On failure the user is signed out, which is the only action that recovers.
     */
    refreshing.current = api
      .refresh(current.refreshToken)
      .then((result) => {
        const next: AdminAuth = {
          ...current,
          accessToken: result.access_token,
          expiresAt: result.expires_at,
        }
        writeAuth(next)
        setAuth(next)
        return next.accessToken
      })
      .catch((err: unknown) => {
        // A 401 means the refresh token is dead. Anything else -- a network blip -- also ends up
        // here, and signing out is still the safe answer: the alternative is a panel that looks
        // signed in but cannot load anything.
        if (isApiError(err)) signOut()
        return null
      })
      .finally(() => {
        refreshing.current = null
      })

    return refreshing.current
  }, [signOut])

  const value = useMemo<AuthValue>(
    () => ({
      auth,
      hydrated,
      token: auth?.accessToken ?? null,
      login,
      logout: signOut,
      getToken,
    }),
    [auth, hydrated, login, signOut, getToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/**
 * Redirects to /login when there is no session, and returns the session when there is.
 *
 * The redirect is in an effect rather than during render because Next forbids navigating while
 * rendering. `hydrated` is honoured for the same reason as in the diner app: on the first render
 * `auth` is null even for a signed-in user, and redirecting then would bounce everybody to the
 * login screen on every page load.
 */
export function useRequireAuth(): AdminAuth | null {
  const { auth, hydrated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (hydrated && auth === null) router.replace('/login')
  }, [hydrated, auth, router])

  return auth
}
