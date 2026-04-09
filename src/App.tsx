/**
 * App — root component that gates the entire UI based on auth status.
 *
 * Rendering logic:
 *   status === "loading"     → null (brief IndexedDB check, < 10ms)
 *   status === "needs-setup" → SetupFlow wizard
 *   status === "locked"      → LockScreen (PIN → password)
 *   status === "unlocked"    → Main app with BottomNav + tab pages
 *
 * The unlocked UI has:
 *   - A SettingsGear icon fixed in the top-right (always visible)
 *   - A BottomNav with two tabs: Passwords and Notes
 *   - The active tab's page component rendered in the content area
 *
 * Settings is NOT a tab — it's accessed via the gear icon and opens
 * as a full-screen overlay.
 */

import { useState } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { ServiceWorkerProvider, useServiceWorker } from './hooks/useServiceWorker'
import SetupFlow from './pages/SetupFlow'
import LockScreen from './pages/LockScreen'
import PasswordsPage from './pages/PasswordsPage'
import NotesPage from './pages/NotesPage'
import BottomNav, { type Tab } from './components/BottomNav'
import SettingsPage from './pages/SettingsPage'
import SettingsGear from './components/SettingsGear'
import UpdatePrompt from './components/UpdatePrompt'
import './styles/glass.css'
import './styles/passwords.css'
import './styles/notes.css'
import './styles/settings.css'

/**
 * AuthGate — reads auth status and decides what to render.
 *
 * Separated from App because useAuth() must be called inside AuthProvider.
 */
function AuthGate() {
  const { status, setup, login } = useAuth()
  const { updateAvailable, updateDismissed } = useServiceWorker()
  const [activeTab, setActiveTab] = useState<Tab>('passwords')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Should we show the update prompt?
  // Yes if: there's an update available AND the user hasn't dismissed it yet.
  // We only show it when unlocked — showing it on the lock screen would be
  // distracting and the user hasn't proven their identity yet.
  const showUpdatePrompt = status === 'unlocked' && updateAvailable && !updateDismissed

  if (status === 'loading') return null
  if (status === 'needs-setup') return <SetupFlow onComplete={setup} />
  if (status === 'locked') return <LockScreen onLogin={login} />

  // ── Unlocked — Main App ──────────────────────────────────────────

  return (
    <div className="main-app">
      {/* Gear icon in top-right — always visible */}
      <SettingsGear onClick={() => setSettingsOpen(!settingsOpen)} />

      {/* Tab content area */}
      <div className="tab-content">
        {activeTab === 'passwords' && <PasswordsPage />}
        {activeTab === 'notes' && <NotesPage />}
      </div>

      {/* Two-tab bottom nav */}
      <BottomNav active={activeTab} onChange={setActiveTab} />

      {/* Settings overlay — slides in from right like iOS navigation */}
      {settingsOpen && (
        <div className="detail-overlay open">
          <SettingsPage onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      {/* Update prompt — glass-styled modal shown after login when a
       * new SW version is waiting. Rendered last so it sits on top. */}
      {showUpdatePrompt && <UpdatePrompt />}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ServiceWorkerProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ServiceWorkerProvider>
    </ThemeProvider>
  )
}
