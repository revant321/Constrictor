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
}
