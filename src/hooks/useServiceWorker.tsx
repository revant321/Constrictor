/**
 * useServiceWorker — React context for service worker update management.
 *
 * This hook solves the "surprise reload" problem with PWAs. By default,
 * a new service worker activates immediately (via skipWaiting), which
 * causes the page to reload without warning. That's bad UX for a password
 * manager where the user might be mid-task.
 *
 * Instead, we detect when a new SW is waiting and let the user decide
 * when to apply the update. The flow:
 *
 *   1. Browser fetches a new sw.js (cache-busted by the browser's
 *      24-hour check or a navigation). The new SW installs and enters
 *      the "waiting" state (because we removed skipWaiting from install).
 *
 *   2. This hook detects the waiting SW and sets `updateAvailable = true`.
 *
 *   3. The UI shows a prompt. If the user taps "Accept", we call
 *      `acceptUpdate()` which posts a SKIP_WAITING message to the
 *      waiting SW. The SW calls skipWaiting(), becomes active, and
 *      the browser fires 'controllerchange' — our listener in main.tsx
 *      reloads the page.
 *
 *   4. If the user taps "Not Now", we set `updateDismissed = true`.
 *      The Settings page checks this flag to show an "Update Available"
 *      card so the user can accept later.
 *
 * Why a context? Both AuthGate (for the post-login prompt) and
 * SettingsPage (for the card) need access to the same update state.
 * A context avoids prop-drilling through multiple layers.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'

// ─── Types ─────────────────────────────────────────────────────────

interface ServiceWorkerContextValue {
  /** True when a new SW is installed and waiting for activation */
  updateAvailable: boolean
  /** True after the user tapped "Not Now" — shows the Settings card */
  updateDismissed: boolean
  /** Send SKIP_WAITING to the waiting SW, triggering activation + reload */
  acceptUpdate: () => void
  /** Hide the prompt, remember that an update is pending */
  dismissUpdate: () => void
}

// ─── Context ───────────────────────────────────────────────────────

const ServiceWorkerContext = createContext<ServiceWorkerContextValue | null>(null)

// ─── Provider ──────────────────────────────────────────────────────

export function ServiceWorkerProvider({ children }: { children: ReactNode }) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    // Only relevant in production — dev mode doesn't register a SW
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

    /**
     * Helper — watch a SW that's installing and promote it to
     * "update available" once it reaches the 'installed' (waiting) state.
     */
    function watchInstalling(worker: ServiceWorker, registration: ServiceWorkerRegistration) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && registration.active) {
          setWaitingWorker(worker)
          setUpdateAvailable(true)
          setUpdateDismissed(false)
        }
      })
    }

    // Get the existing registration. navigator.serviceWorker.ready
    // resolves when there's an active SW controlling the page.
    navigator.serviceWorker.ready.then((registration) => {
      // Case 1: A SW is already waiting when the page loads.
      // This happens if the user closed the app before accepting a
      // previous update — the new SW has been sitting in "waiting"
      // state since then.
      if (registration.waiting) {
        setWaitingWorker(registration.waiting)
        setUpdateAvailable(true)
        return
      }

      // Case 2: A SW is currently installing (the browser started the
      // update check during navigation, before React mounted). The
      // 'updatefound' event already fired, so we'd miss it if we only
      // listened for future events. Watch this worker's state directly.
      if (registration.installing) {
        watchInstalling(registration.installing, registration)
      }

      // Case 3: A new SW starts installing in the future (e.g., the
      // browser's 24-hour recheck, or a manual registration.update()).
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return
        watchInstalling(newWorker, registration)
      })

      // Proactively check for updates — don't rely solely on the
      // browser's automatic check, which may be delayed or cached.
      registration.update()
    })
  }, [])

  /**
   * Accept the update — post a message to the waiting SW telling it
   * to call skipWaiting(). The SW activates, 'controllerchange' fires,
   * and our listener in main.tsx reloads the page.
   */
  const acceptUpdate = useCallback(() => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    }
  }, [waitingWorker])

  /**
   * Dismiss the prompt — the update is still available (the SW is
   * still waiting), but we stop showing the modal prompt. Instead,
   * Settings will show a card the user can tap later.
   */
  const dismissUpdate = useCallback(() => {
    setUpdateDismissed(true)
  }, [])

  return (
    <ServiceWorkerContext.Provider
      value={{ updateAvailable, updateDismissed, acceptUpdate, dismissUpdate }}
    >
      {children}
    </ServiceWorkerContext.Provider>
  )
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useServiceWorker(): ServiceWorkerContextValue {
  const context = useContext(ServiceWorkerContext)
  if (!context) {
    throw new Error('useServiceWorker must be used within a ServiceWorkerProvider')
  }
  return context
}
