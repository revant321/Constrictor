/**
 * LockScreen — two-stage unlock flow: PIN → Password → login().
 *
 * This page appears whenever the vault is locked (app was closed,
 * backgrounded, or manually locked). It gates access to all encrypted data.
 *
 * The flow is a two-stage state machine:
 *
 *   Stage 1: "pin"
 *     - Shows the PinPad component (same one used in SetupFlow)
 *     - When the user enters all 6 digits, we store them and advance
 *     - No validation yet — we can't check the PIN alone because we need
 *       both PIN + password to derive the key
 *
 *   Stage 2: "password"
 *     - Shows a master password text input
 *     - On submit, calls login(pin, password) which derives the key via
 *       PBKDF2 and checks it against the stored verification token
 *     - If valid → useAuth transitions to "unlocked" (parent handles this)
 *     - If invalid → shows an error, then resets back to stage 1 so the
 *       user must re-enter BOTH credentials (security measure — if only
 *       the password was wrong, an attacker could brute-force just that half)
 *
 * Why reset both on failure?
 *   The PIN + password are combined during key derivation. If we let the user
 *   retry just the password, we'd be confirming that their PIN was "correct"
 *   (it wasn't checked independently). Resetting both means an attacker gains
 *   no information about which half was wrong.
 *
 * Props:
 *   - onLogin(pin, password): async function from useAuth. Returns true if
 *     credentials are correct, false otherwise.
 */

import { useState, useCallback, type FormEvent } from 'react'
import PinPad from '../components/PinPad'
import '../styles/glass.css'

type Stage = 'pin' | 'password'

interface LockScreenProps {
  onLogin: (pin: string, masterPassword: string) => Promise<boolean>
}

export default function LockScreen({ onLogin }: LockScreenProps) {
  // ── State ────────────────────────────────────────────────────────

  // Which stage we're on. Starts at "pin", advances to "password" after
  // all 6 digits are entered, resets to "pin" on failed login.
  const [stage, setStage] = useState<Stage>('pin')

  // The PIN entered in stage 1. Held in memory until we pass it to login().
  const [pin, setPin] = useState('')

  // The text currently in the password input (controlled input).
  const [inputValue, setInputValue] = useState('')

  // Whether the PinPad should show its error state (red dots + shake).
  // This is set to true briefly when login fails, then cleared after the
  // shake animation finishes (PinPad handles the timing internally).
  const [pinError, setPinError] = useState(false)

  // Text error message shown on the password stage when login fails.
  const [passwordError, setPasswordError] = useState('')

  // Whether we're currently waiting for PBKDF2 key derivation + verification.
  // This takes ~0.3-0.5s — during this time we disable the submit button
  // and show "Verifying..." to prevent double-submits.
  const [verifying, setVerifying] = useState(false)

  // ── Stage 1: PIN complete ──────────────────────────────────────

  /**
   * Called by PinPad when all 6 digits are entered.
   * We store the PIN and advance to the password stage.
   *
   * No validation here — we can't verify the PIN alone because the
   * encryption key requires BOTH PIN + password. We just advance.
   */
  const handlePinComplete = useCallback((enteredPin: string) => {
    setPin(enteredPin)
    setStage('password')
  }, [])

  // ── Stage 2: Password submit ────────────────────────────────────

  /**
   * Called when the user submits the password form.
   *
   * This is where the actual authentication happens:
   *   1. Derive key from PIN + password via PBKDF2 (slow, ~0.3-0.5s)
   *   2. Try to decrypt the verification token with the derived key
   *   3. If decryption succeeds → correct credentials → unlock
   *   4. If decryption fails → wrong credentials → reset to PIN stage
   *
   * On failure, we reset EVERYTHING — pin, password input, and stage.
   * The user sees the PinPad again with a shake animation to indicate
   * the error. This is intentional: see the component doc comment above
   * for the security rationale.
   */
  const handlePasswordSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()

    if (!inputValue.trim()) return

    setVerifying(true)
    setPasswordError('')

    const success = await onLogin(pin, inputValue)

    if (success) {
      // Login succeeded — useAuth will set status to "unlocked" and the
      // parent (App.tsx AuthGate) will unmount this component.
      return
    }

    // Login failed — reset everything and go back to PIN stage.
    setVerifying(false)
    setInputValue('')
    setPin('')
    setStage('pin')

    // Trigger the PinPad error animation after a microtask delay.
    // We need the stage change to commit first so PinPad is mounted
    // before it receives the error prop. Without this, React might
    // batch the state updates and PinPad wouldn't see error go from
    // false → true (it would just mount with error=true, which doesn't
    // trigger its useEffect that expects a change).
    setTimeout(() => {
      setPinError(true)
      // Clear error after the shake animation completes (~500ms in PinPad)
      // so the prop can toggle again on future failures.
      setTimeout(() => setPinError(false), 600)
    }, 50)
  }, [inputValue, pin, onLogin])

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="screen-center">
      {/* Lock icon — visual anchor that says "this app is locked" */}
      <div style={{
        fontSize: '48px',
        marginBottom: '24px',
        textAlign: 'center',
      }}>
        🔐
      </div>

      {/* ── Stage 1: PIN entry ──────────────────────────────────── */}
      {stage === 'pin' && (
        <PinPad
          title="Enter your PIN"
          subtitle="Enter your 6-digit PIN to begin"
          onComplete={handlePinComplete}
          error={pinError}
        />
      )}

      {/* ── Stage 2: Password entry ─────────────────────────────── */}
      {stage === 'password' && (
        <div className="fade-in" style={{
          textAlign: 'center',
          width: '100%',
          maxWidth: '320px',
        }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '8px',
            color: '#f3f4f6',
          }}>
            Master Password
          </h2>

          <p style={{
            fontSize: '15px',
            color: 'rgba(255, 255, 255, 0.5)',
            marginBottom: '32px',
          }}>
            Enter your master password to unlock
          </p>

          {/* Password form — wrapping in <form> so Enter key submits
           *  naturally on all platforms (keyboard, mobile, etc.). */}
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              className="glass-input"
              placeholder="Master password"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                // Clear stale error when user starts correcting input.
                if (passwordError) setPasswordError('')
              }}
              autoFocus
              autoComplete="off"
              style={{ marginBottom: '16px' }}
            />

            {/* Error message — rose/red color matching the PIN dot error state */}
            {passwordError && (
              <p className="fade-in" style={{
                fontSize: '14px',
                color: 'rgba(244, 63, 94, 0.9)',
                marginBottom: '16px',
              }}>
                {passwordError}
              </p>
            )}

            <button
              type="submit"
              className="glass-btn glass-btn-primary"
              disabled={!inputValue.trim() || verifying}
              style={{ width: '100%', marginBottom: '16px' }}
            >
              {verifying ? 'Verifying...' : 'Unlock'}
            </button>
          </form>

          {/* Back button — if the user realizes they fat-fingered a PIN
           *  digit, they can go back without submitting a wrong password. */}
          <button
            className="glass-btn"
            onClick={() => {
              setStage('pin')
              setPin('')
              setInputValue('')
              setPasswordError('')
            }}
            style={{
              width: '100%',
              fontSize: '15px',
              padding: '12px',
              opacity: 0.7,
            }}
          >
            Re-enter PIN
          </button>
        </div>
      )}
    </div>
  )
}
