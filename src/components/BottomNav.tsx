/**
 * BottomNav — fixed bottom tab bar with two tabs: Passwords and Notes.
 *
 * Settings is NOT a tab — it lives as a gear icon in the top-right corner
 * of the screen (handled separately). The active tab is highlighted in teal.
 * We use inline SVGs to avoid any icon library dependency.
 */

export type Tab = 'passwords' | 'notes'

interface BottomNavProps {
  active: Tab
  onChange: (tab: Tab) => void
}

export default function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`nav-tab${active === 'passwords' ? ' active' : ''}`}
        onClick={() => onChange('passwords')}
      >
        {/* Key icon — represents passwords/vault */}
        <svg viewBox="0 0 24 24">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
        Passwords
      </button>

      <button
        className={`nav-tab${active === 'notes' ? ' active' : ''}`}
        onClick={() => onChange('notes')}
      >
        {/* Notebook icon — represents secure notes */}
        <svg viewBox="0 0 24 24">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Notes
      </button>
    </nav>
  )
}
