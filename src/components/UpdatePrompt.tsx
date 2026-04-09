/**
 * UpdatePrompt — glass-styled modal for service worker update approval.
 *
 * This appears as a centered card on a dimmed backdrop when a new SW
 * version is waiting. It gives the user two choices:
 *
 *   "Accept"  → sends SKIP_WAITING to the SW, which activates and
 *               triggers a page reload via the controllerchange listener.
 *
 *   "Not Now" → dismisses the prompt. The update stays available in
 *               the Settings page as an "App Update Available" card
 *               so the user can accept it later.
 *
 * Why a modal instead of a toast? Updates reload the page, which wipes
 * any in-progress work (e.g., a half-typed password). A modal forces
 * a deliberate choice rather than an accidental tap.
 */

import { useServiceWorker } from '../hooks/useServiceWorker'

export default function UpdatePrompt() {
  const { acceptUpdate, dismissUpdate } = useServiceWorker()

  return (
    <div className="update-prompt-backdrop">
      <div className="glass-card update-prompt fade-in">
        <div className="update-prompt-icon">
          {/* Download/arrow-down icon — suggests "new version ready" */}
          <svg viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <h2 className="update-prompt-title">An update is available</h2>
        <p className="update-prompt-description">
          Accept the update to get the latest version. The app will reload briefly.
        </p>
        <div className="update-prompt-actions">
          <button
            className="glass-btn update-prompt-dismiss"
            onClick={dismissUpdate}
          >
            Not Now
          </button>
          <button
            className="glass-btn glass-btn-primary update-prompt-accept"
            onClick={acceptUpdate}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
