/**
 * useAuth — React context for authentication state.
 *
 * This hook wraps the auth service (auth.ts) in React state so that
 * components can reactively respond to auth changes. It also sets up
 * browser event listeners to auto-lock the app.
 *
 * Architecture:
 *   - AuthProvider wraps the entire app (placed in App.tsx or main.tsx)
 *   - Any component calls useAuth() to get the current state + actions
 *   - State changes trigger re-renders in all consuming components
 *
 * Auth states:
 *   "loading"     → Checking IndexedDB for existing vault (async, brief)
 *   "needs-setup" → No vault found → show setup flow
 *   "locked"      → Vault exists, key not in memory → show lock screen
 *   "unlocked"    → Key in memory → show main app
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import {
  setup as authSetup,
  login as authLogin,
  lock as authLock,
  isSetupComplete,
  getLockBehavior,
  isUnlocked,
} from '../services/auth'

// ─── Types ─────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'needs-setup' | 'locked' | 'unlocked'

/**
 * The shape of the context value that useAuth() returns.
 *
 * `status` — current auth state (drives which screen the app shows)
 * `setup`  — called from SetupFlow after user picks PIN + password
 * `login`  — called from LockScreen when user enters credentials
 * `lock`   — called to manually lock (e.g., from a "Lock Now" button)
 *
 * setup() and login() are async because they involve PBKDF2 key derivation
 * (~0.3-0.5 seconds). The UI should show a loading indicator during this.
 */
interface AuthContextValue {
  status: AuthStatus
  setup: (pin: string, masterPassword: string) => Promise<void>
  login: (pin: string, masterPassword: string) => Promise<boolean>
  lock: () => void
}

// ─── Context ───────────────────────────────────────────────────────

/**
 * React Context for auth state. We initialize with a default that throws
 * if someone tries to use useAuth() outside of an AuthProvider — this is
 * a developer error, not a user error, so a loud failure is appropriate.
 */
const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Provider ──────────────────────────────────────────────────────

/**
 * AuthProvider — wraps the app and manages auth state + lock listeners.
 *
 * On mount, it checks IndexedDB to determine the initial state:
 *   - Is setup complete? → "locked" (vault exists, needs credentials)
 *   - No setup? → "needs-setup" (first time, show setup flow)
 *
 * It also sets up browser event listeners for auto-locking based on
 * the user's lock behavior preference. These listeners are cleaned up
 * properly to avoid memory leaks.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')

  // ── Initial state check ──────────────────────────────────────────
  //
  // On mount, we read from IndexedDB to figure out where we are.
  // This is async because IndexedDB reads are async, but it's fast
  // (< 10ms typically). During this brief window, status is "loading".

  useEffect(() => {
    async function checkInitialState() {
      const setupDone = await isSetupComplete()

      if (!setupDone) {
        // No vault exists — user needs to go through setup.
        setStatus('needs-setup')
      } else if (isUnlocked()) {
        // Vault exists AND key is in memory (e.g., hot module reload in dev).
        // This case is rare in production but common during development.
        setStatus('unlocked')
      } else {
        // Vault exists, key not in memory — need to authenticate.
        setStatus('locked')
      }
    }

    checkInitialState()
  }, [])

  // ── Lock event listeners ─────────────────────────────────────────
  //
  // We set up different listeners based on the lock behavior setting:
  //
  // "close" mode (default):
  //   - `pagehide`: fires when the page is being unloaded. On iOS Safari,
  //     this is more reliable than `beforeunload` for PWAs. When the user
  //     swipes the app away, this fires. We lock here.
  //
  // "background" mode (more secure):
  //   - `visibilitychange`: fires whenever the page becomes hidden or visible.
  //     Hidden = user switched tabs, went to home screen, or switched apps.
  //     We lock as soon as the page is hidden — much more aggressive.
  //
  // Why not `beforeunload`? It's unreliable on mobile Safari and doesn't
  // fire consistently in PWA mode. `pagehide` is the modern replacement.

  useEffect(() => {
    // Only set up lock listeners when unlocked.
    // If we're locked or in setup, there's nothing to protect.
    if (status !== 'unlocked') return

    let lockBehavior: 'close' | 'background' = 'close'

    // We need to read the lock behavior from DB (async), then set up listeners.
    // Using an IIFE (Immediately Invoked Function Expression) because useEffect
    // callbacks can't be async directly.
    const controller = new AbortController()

    ;(async () => {
      lockBehavior = await getLockBehavior()

      // If the component unmounted while we were reading DB, bail out.
      if (controller.signal.aborted) return

      if (lockBehavior === 'background') {
        // "Lock on background" — lock as soon as the page is hidden.
        // This fires when: switching tabs, going to home screen, opening
        // another app, or closing the browser.
        document.addEventListener(
          'visibilitychange',
          handleVisibilityChange,
          { signal: controller.signal },
        )
      }

      // "Lock on close" — always listen for pagehide regardless of mode.
      // In "background" mode this is redundant (visibilitychange fires first),
      // but it's a safety net that costs nothing.
      window.addEventListener(
        'pagehide',
        handlePageHide,
        { signal: controller.signal },
      )
    })()

    function handleVisibilityChange() {
      // document.hidden is true when the page is not visible.
      // We only lock when hiding, not when coming back (that would be pointless).
      if (document.hidden) {
        authLock()
        setStatus('locked')
      }
    }

    function handlePageHide() {
      // pagehide fires when the page is being navigated away from or closed.
      // We lock unconditionally — if the page is hiding, we want the key gone.
      authLock()
      setStatus('locked')
    }

    // Cleanup: remove all listeners when the component unmounts or when
    // status changes (e.g., when we lock, the listeners are no longer needed).
    return () => {
      controller.abort()
    }
  }, [status])

  // ── Actions ──────────────────────────────────────────────────────
  //
  // These are wrapped in useCallback to maintain stable references.
  // Without useCallback, every render would create new function objects,
  // which could cause unnecessary re-renders in consuming components
  // that use these functions in dependency arrays.

  /**
   * Complete first-time setup with the user's chosen credentials.
   * After this, the user is automatically unlocked (no need to re-enter).
   */
  const handleSetup = useCallback(async (pin: string, masterPassword: string) => {
    await authSetup(pin, masterPassword)
    setStatus('unlocked')
  }, [])

  /**
   * Attempt to log in with the given credentials.
   * Returns true if successful (and transitions to "unlocked"),
   * false if credentials are wrong (stays "locked").
   *
   * The UI should show an error message on false and let the user retry.
   */
  const handleLogin = useCallback(async (pin: string, masterPassword: string) => {
    const success = await authLogin(pin, masterPassword)
    if (success) {
      setStatus('unlocked')
    }
    return success
  }, [])

  /**
   * Manually lock the app. Called from a "Lock Now" button in settings
   * or anywhere else the user wants to explicitly lock.
   */
  const handleLock = useCallback(() => {
    authLock()
    setStatus('locked')
  }, [])

  // ── Render ───────────────────────────────────────────────────────

  return (
    <AuthContext.Provider
      value={{
        status,
        setup: handleSetup,
        login: handleLogin,
        lock: handleLock,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ──────────────────────────────────────────────────────────

/**
 * useAuth — the hook that components call to access auth state and actions.
 *
 * Usage:
 *   const { status, setup, login, lock } = useAuth()
 *
 *   if (status === 'loading') return <Spinner />
 *   if (status === 'needs-setup') return <SetupFlow onComplete={setup} />
 *   if (status === 'locked') return <LockScreen onLogin={login} />
 *   return <MainApp />  // status === 'unlocked'
 *
 * Throws if called outside of AuthProvider — this is a developer error.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
