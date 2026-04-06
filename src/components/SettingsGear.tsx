/**
 * SettingsGear — persistent gear icon in the top-right corner.
 *
 * Always visible regardless of which tab is active. Tapping it:
 *   1. Plays a smooth rotation animation on the gear (360deg spin)
 *   2. Opens the settings page/modal
 *
 * The rotation uses a CSS transition triggered by toggling a class.
 * We use a state variable `spinning` that gets set to true on click,
 * then reset after the animation completes (via onTransitionEnd).
 */

import { useState } from 'react'

interface SettingsGearProps {
  onClick: () => void
}

export default function SettingsGear({ onClick }: SettingsGearProps) {
  const [spinning, setSpinning] = useState(false)

  const handleClick = () => {
    setSpinning(true)
    onClick()
  }

  return (
    <button
      className={`settings-gear${spinning ? ' spin' : ''}`}
      onClick={handleClick}
      onTransitionEnd={() => setSpinning(false)}
      aria-label="Settings"
    >
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  )
}
