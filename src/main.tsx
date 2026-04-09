import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/Constrictor">
      <App />
    </BrowserRouter>
  </StrictMode>,
)

/**
 * Service Worker Registration
 *
 * We register the SW after the app renders (not blocking the initial paint).
 * The SW file lives in /public/sw.js — Vite serves it at the root.
 *
 * Only register in production — in dev mode, the SW would cache stale
 * assets and break hot module replacement (HMR). We check that the
 * serviceWorker API exists (it doesn't in some browsers or non-HTTPS contexts).
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/Constrictor/sw.js').catch((err) => {
      console.warn('SW registration failed:', err)
    })
  })

  /**
   * controllerchange — fires when a new SW takes over (after skipWaiting).
   *
   * When the user accepts an update, the waiting SW calls skipWaiting()
   * and becomes the active controller. The browser fires this event on
   * all pages controlled by the old SW. We reload so the page uses the
   * new cached assets from the updated SW.
   *
   * Why here instead of in React? This is a one-time, page-level event.
   * Putting it in a React component would mean it only fires if that
   * component is mounted, and we'd need to handle cleanup. A global
   * listener is simpler and more reliable — it works regardless of
   * which screen the user is on.
   */
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guard against multiple reloads — controllerchange can fire
    // more than once in edge cases (e.g., multiple tabs).
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}
