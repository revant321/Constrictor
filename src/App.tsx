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
import SetupFlow from './pages/SetupFlow'
import LockScreen from './pages/LockScreen'
import PasswordsPage from './pages/PasswordsPage'
import NotesPage from './pages/NotesPage'
import BottomNav, { type Tab } from './components/BottomNav'
import SettingsGear from './components/SettingsGear'
import './styles/glass.css'
import './styles/passwords.css'
import './styles/notes.css'

/**
 * AuthGate — reads auth status and decides what to render.
 *
 * Separated from App because useAuth() must be called inside AuthProvider.
 */
function AuthGate() {
  const { status, setup, login } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('passwords')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

      {/* Settings overlay — placeholder for Phase 5 */}
      {settingsOpen && (
        <div className="detail-overlay open">
          <div className="detail-header">
            <button className="detail-back" onClick={() => setSettingsOpen(false)}>
              <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
          </div>
          <div className="detail-body">
            <div className="page-header" style={{ paddingLeft: 0 }}>
              <h1 className="page-title">Settings</h1>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', padding: '0 0 20px', fontSize: '15px' }}>
              Settings will be built in Phase 5 (lock behavior, change PIN, change password, export/import).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}
