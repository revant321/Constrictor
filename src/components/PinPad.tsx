/**
 * PinPad — iPhone-style numeric keypad for PIN entry.
 *
 * Layout:
 *   [1] [2] [3]
 *   [4] [5] [6]
 *   [7] [8] [9]
 *   [ ] [0] [⌫]
 *
 * This mimics the iOS passcode screen. The component:
 *   - Shows 6 dot indicators that fill as digits are entered
 *   - Auto-submits when all 6 digits are entered (calls onComplete)
 *   - Supports a backspace button to delete the last digit
 *   - Triggers haptic feedback (navigator.vibrate) on each press
 *   - Can show an error state (red dots + shake animation)
 *   - Listens for keyboard events (0-9 and Backspace) for desktop use
 *
 * Props:
 *   - onComplete(pin): called when all 6 digits are entered
 *   - error: when true, shows red dots + shake, then auto-clears
 *   - title: the heading text above the dots (e.g., "Create PIN")
 *   - subtitle: optional smaller text below the title
 */

import { useState, useEffect, useCallback } from 'react'
import '../styles/glass.css'

const PIN_LENGTH = 6

interface PinPadProps {
  onComplete: (pin: string) => void
  error?: boolean
  title: string
  subtitle?: string
}

export default function PinPad({ onComplete, error, title, subtitle }: PinPadProps) {
  // The digits entered so far, stored as a string (e.g., "12" = two digits in).
  // String rather than number[] because it's simpler to concatenate and pass
  // directly to the auth functions which expect a string.
  const [digits, setDigits] = useState('')

  // Track whether we're in the "shaking" state (wrong PIN animation).
  // Separate from the `error` prop because we need to clear it after the
  // animation finishes (500ms), while the parent controls `error`.
  const [shaking, setShaking] = useState(false)

  // ── Error handling ──────────────────────────────────────────────
  // When the parent sets error=true (wrong PIN), we:
  //   1. Show red dots + shake animation
  //   2. Wait 500ms for the animation to complete
  //   3. Clear the dots so the user can retry
  //
  // The parent should toggle error back to false after this cycle.

  useEffect(() => {
    if (!error) return

    setShaking(true)
    const timer = setTimeout(() => {
      setShaking(false)
      setDigits('')
    }, 500)

    return () => clearTimeout(timer)
  }, [error])

  // ── Digit press handler ─────────────────────────────────────────
  // Appends a digit to the PIN string. When all 6 are entered, calls
  // onComplete with the full PIN.
  //
  // We read the NEW value (`next`) rather than `digits` when checking
  // length, because React state updates are async — `digits` still
  // holds the old value within this same event handler.

  const handleDigit = useCallback((digit: string) => {
    if (digits.length >= PIN_LENGTH) return

    // Haptic feedback — a 10ms vibration on each press.
    // navigator.vibrate isn't available on iOS Safari, but the optional
    // chaining safely no-ops. On Android it adds a nice native feel.
    navigator.vibrate?.(10)

    const next = digits + digit
    setDigits(next)

    if (next.length === PIN_LENGTH) {
      onComplete(next)
    }
  }, [digits, onComplete])

  // ── Backspace handler ───────────────────────────────────────────
  // Removes the last digit. Uses the functional form of setState
  // (prev => ...) so it doesn't need `digits` in its dependency array.

  const handleBackspace = useCallback(() => {
    setDigits(prev => prev.slice(0, -1))
  }, [])

  // ── Keyboard support ─────────────────────────────────────────────
  // Listen for physical keyboard events so desktop/laptop users can type
  // their PIN directly instead of clicking the on-screen buttons.
  //
  // We attach the listener to `document` rather than a specific element
  // because the PinPad doesn't have a single focusable container — it's
  // a visual-only keypad. Using `document` means key presses work as
  // soon as the PinPad is visible, no need to click into it first.
  //
  // The dependency array includes both handlers. `handleDigit` changes
  // whenever `digits` changes (because it closes over `digits`), so the
  // listener re-subscribes with the updated closure on each keystroke.
  // `handleBackspace` uses functional setState and never changes.

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Digits 0-9: the `key` property gives us the character directly.
      // We check for single-character digit strings rather than using
      // keyCode (deprecated) or charCode.
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
        return
      }

      // Backspace: delete the last entered digit.
      // We preventDefault to stop the browser from navigating back
      // (some browsers treat Backspace as "go back a page").
      if (e.key === 'Backspace') {
        e.preventDefault()
        handleBackspace()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleDigit, handleBackspace])

  // ── Render ──────────────────────────────────────────────────────

  // The keypad grid — null = empty cell (bottom-left) for alignment.
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [null, '0', 'backspace'],
  ]

  return (
    <div className="fade-in" style={{ textAlign: 'center' }}>
      {/* Title — e.g., "Create your PIN" or "Confirm your PIN" */}
      <h2 style={{
        fontSize: '22px',
        fontWeight: 600,
        marginBottom: subtitle ? '8px' : '32px',
        color: 'var(--text-primary)',
      }}>
        {title}
      </h2>

      {/* Optional subtitle — e.g., "Enter the same PIN again" */}
      {subtitle && (
        <p style={{
          fontSize: '15px',
          color: 'var(--text-secondary)',
          marginBottom: '32px',
        }}>
          {subtitle}
        </p>
      )}

      {/* PIN dot indicators — 6 circles that fill in left-to-right.
       *  The shake class is applied to the container so all dots
       *  shake together as a group, like iOS does. */}
      <div
        className={shaking ? 'shake' : ''}
        style={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          marginBottom: '40px',
        }}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`pin-dot${i < digits.length ? ' filled' : ''}${shaking ? ' error' : ''}`}
          />
        ))}
      </div>

      {/* Numeric keypad — 4 rows, 3 columns */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        alignItems: 'center',
      }}>
        {keys.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: 'flex', gap: '24px' }}>
            {row.map((key, colIndex) => {
              // Empty spacer cell (bottom-left) — invisible but keeps grid aligned.
              if (key === null) {
                return <div key={colIndex} style={{ width: 72, height: 72 }} />
              }

              // Backspace button — shows ⌫, hidden when there are no digits.
              // We use visibility (not display) so the grid doesn't reflow.
              if (key === 'backspace') {
                return (
                  <button
                    key={colIndex}
                    className="pin-btn"
                    onClick={handleBackspace}
                    style={{
                      fontSize: '24px',
                      visibility: digits.length > 0 ? 'visible' : 'hidden',
                    }}
                    aria-label="Delete"
                  >
                    ⌫
                  </button>
                )
              }

              // Number button (0-9) — large circular glass button.
              return (
                <button
                  key={colIndex}
                  className="pin-btn"
                  onClick={() => handleDigit(key)}
                >
                  {key}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
