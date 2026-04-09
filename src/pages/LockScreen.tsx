/**
 * LockScreen — three-stage unlock flow: Biometric → PIN → Password → login().
 *
 * This page appears whenever the vault is locked (app was closed,
 * backgrounded, or manually locked). It gates access to all encrypted data.
 *
 * The flow is a three-stage state machine:
 *
 *   Stage 0: "biometric" (optional — only if biometrics are enabled)
 *     - Shows a fingerprint/face icon inside a frosted glass circle
 *     - Auto-triggers Face ID / Touch ID via WebAuthn on mount
 *     - On success → advance to PIN stage
 *     - On failure → show error + Retry button. User CANNOT skip.
 *     - If biometrics are enabled but the device doesn't support them
 *       (e.g., user switched devices), silently skip to PIN.
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
 *     - If invalid → shows an error, then resets ALL the way back to
 *       the biometric stage (if enabled) or PIN stage (if not). User must
 *       pass ALL gates again.
 *
 * Why reset ALL stages on failure?
 *   The PIN + password are combined during key derivation. If we let the user
 *   retry just the password, we'd be confirming that their PIN was "correct"
 *   (it wasn't checked independently). Resetting both means an attacker gains
 *   no information about which half was wrong. Adding biometrics as the first
 *   gate means an attacker must also pass Face ID / Touch ID before even
 *   attempting the PIN, providing defense-in-depth.
 *
 * Props:
 *   - onLogin(pin, password): async function from useAuth. Returns true if
 *     credentials are correct, false otherwise.
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import PinPad from '../components/PinPad'
import {
  canUseBiometrics,
  isBiometricsEnabled,
  verifyBiometric,
  getBiometricType,
} from '../services/biometrics'
import '../styles/glass.css'

type Stage = 'biometric' | 'pin' | 'password'

// ─── Brute-force protection constants ─────────────────────────────
//
// After MAX_ATTEMPTS consecutive wrong logins, the user is locked out for
// LOCKOUT_DURATION milliseconds. This is stored in React state (memory only)
// — restarting the app resets the counter, which is acceptable because the
// real protection is the encryption strength (AES-256-GCM with 600k PBKDF2
// iterations). The lockout just slows down casual brute-force attempts.

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 5 * 60 * 1000 // 5 minutes in milliseconds

interface LockScreenProps {
  onLogin: (pin: string, masterPassword: string) => Promise<boolean>
}

export default function LockScreen({ onLogin }: LockScreenProps) {
  // ── State ────────────────────────────────────────────────────────

  // Start at 'pin' by default. The biometric check on mount may change
  // this to 'biometric' if biometrics are enabled and supported.
  const [stage, setStage] = useState<Stage>('pin')
  const [pin, setPin] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [pinError, setPinError] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [verifying, setVerifying] = useState(false)

  // ── Biometric state ────────────────────────────────────────────
  //
  // biometricsActive: true if biometrics should be used in this session.
  //   Set on mount after checking the database flag AND device capability.
  //
  // biometricError: error message shown when Face ID / Touch ID fails.
  //   Cleared when the user taps Retry.
  //
  // biometricVerifying: true while the WebAuthn prompt is active.
  //   Used to show "Verifying identity..." text.

  const [biometricsActive, setBiometricsActive] = useState(false)
  const [biometricError, setBiometricError] = useState('')
  const [biometricVerifying, setBiometricVerifying] = useState(false)

  // ── Brute-force protection state ────────────────────────────────
  //
  // failedAttempts: incremented on each wrong login. Reset on success
  //   or when the lockout cooldown expires.
  //
  // lockoutUntil: a Unix timestamp (Date.now() + 5 minutes) set when
  //   failedAttempts reaches MAX_ATTEMPTS. While Date.now() < lockoutUntil,
  //   the PIN pad is hidden and a countdown timer is shown instead.
  //
  // lockoutRemaining: milliseconds left in the lockout, updated every
  //   second by a setInterval timer. Used to render the countdown display.

  const [failedAttempts, setFailedAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [lockoutRemaining, setLockoutRemaining] = useState(0)

  // Is the user currently locked out?
  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil

  // ── Lockout countdown timer ─────────────────────────────────────
  //
  // When lockoutUntil is set, we start a 1-second interval that updates
  // lockoutRemaining. When it reaches 0, we clear the lockout and reset
  // the attempt counter so the user gets 5 fresh attempts.

  useEffect(() => {
    if (!lockoutUntil) return

    const update = () => {
      const remaining = lockoutUntil - Date.now()
      if (remaining <= 0) {
        // Cooldown expired — let them try again with fresh attempts.
        setLockoutUntil(null)
        setLockoutRemaining(0)
        setFailedAttempts(0)
      } else {
        setLockoutRemaining(remaining)
      }
    }

    // Run immediately (so the display doesn't show stale values for 1s),
    // then every second.
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [lockoutUntil])

  // ── Biometric initialization ─────────────────────────────────────
  //
  // On mount, we check two things:
  //   1. Is biometrics enabled in the database? (user turned it on in Settings)
  //   2. Does this device actually support biometrics? (hardware + HTTPS)
  //
  // If BOTH are true, we start at the 'biometric' stage and auto-trigger
  // the Face ID / Touch ID prompt.
  //
  // If biometrics are enabled in the DB but the device doesn't support them
  // (e.g., user imported their vault to a device without biometric hardware),
  // we silently skip to PIN. We DON'T disable the flag in the database because
  // the user might go back to the original device where it works.

  useEffect(() => {
    let cancelled = false

    async function checkBiometrics() {
      const [enabled, capable] = await Promise.all([
        isBiometricsEnabled(),
        canUseBiometrics(),
      ])

      if (cancelled) return

      if (enabled && capable) {
        setBiometricsActive(true)
        setStage('biometric')
        // Auto-trigger the biometric prompt after a tiny delay to let
        // the UI render the biometric stage first.
        setTimeout(() => {
          if (!cancelled) triggerBiometric()
        }, 300)
      }
      // If enabled but not capable, we stay at 'pin' (the default).
      // If not enabled at all, we stay at 'pin'.
    }

    checkBiometrics()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Biometric trigger ───────────────────────────────────────────
  //
  // Calls verifyBiometric() which triggers the native Face ID / Touch ID
  // prompt. On success, advances to PIN stage. On failure, shows an error
  // message with a Retry button.

  const triggerBiometric = useCallback(async () => {
    setBiometricVerifying(true)
    setBiometricError('')

    const passed = await verifyBiometric()

    setBiometricVerifying(false)

    if (passed) {
      setStage('pin')
    } else {
      setBiometricError('Biometric verification failed')
    }
  }, [])

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

    // Login failed — track the attempt for brute-force protection.
    const newAttempts = failedAttempts + 1
    setFailedAttempts(newAttempts)

    // If they've hit the limit, start the lockout cooldown.
    // The countdown timer (useEffect above) will handle the rest.
    if (newAttempts >= MAX_ATTEMPTS) {
      setLockoutUntil(Date.now() + LOCKOUT_DURATION)
    }

    // Reset everything and go back to the FIRST stage.
    // If biometrics are active, the user must pass Face ID / Touch ID again
    // before they can even attempt the PIN. This is defense-in-depth: a failed
    // login attempt resets ALL gates, not just the password.
    setVerifying(false)
    setInputValue('')
    setPin('')
    setStage(biometricsActive ? 'biometric' : 'pin')

    // Trigger the PinPad error animation after a microtask delay.
    setTimeout(() => {
      setPinError(true)
      setTimeout(() => setPinError(false), 600)
    }, 50)
  }, [inputValue, pin, onLogin, failedAttempts, biometricsActive])

  // ── Render ──────────────────────────────────────────────────────

  // ── Render ──────────────────────────────────────────────────────

  // Format the lockout countdown as MM:SS for a clean display.
  const lockoutMinutes = Math.floor(lockoutRemaining / 60000)
  const lockoutSeconds = Math.floor((lockoutRemaining % 60000) / 1000)
  const lockoutDisplay = `${lockoutMinutes}:${lockoutSeconds.toString().padStart(2, '0')}`

  // Calculate lockout progress (0 → 1) for the timer bar animation.
  // 1 = just started lockout, 0 = lockout complete.
  const lockoutProgress = lockoutUntil
    ? Math.max(0, (lockoutUntil - Date.now()) / LOCKOUT_DURATION)
    : 0

  return (
    <div className="screen-center">
      {/* Lock icon — SVG inside a frosted glass circle.
       *  Hidden during the biometric stage because that stage has its own
       *  larger icon (fingerprint). Showing both would be redundant. */}
      {stage !== 'biometric' && (
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-shadow), var(--glass-highlight)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      )}

      {/* ── Lockout state — too many failed attempts ────────────── */}
      {isLockedOut && (
        <div className="lockout-container fade-in">
          <h2 className="lockout-title">Too Many Attempts</h2>
          <p className="lockout-subtitle">
            Try again in
          </p>
          <div className="lockout-timer">{lockoutDisplay}</div>
          <div className="lockout-bar-track">
            <div
              className="lockout-bar-fill"
              style={{ width: `${lockoutProgress * 100}%` }}
            />
          </div>
          <p className="lockout-hint">
            {MAX_ATTEMPTS} consecutive failed attempts detected
          </p>
        </div>
      )}

      {/* ── Stage 0: Biometric verification ──────────────────────
       *
       * Shows a fingerprint/face icon inside a frosted glass circle.
       * Auto-triggers Face ID / Touch ID on mount. If verification fails,
       * shows an error message and a Retry button.
       *
       * The user CANNOT skip this stage — they must pass biometrics before
       * seeing the PIN pad. This prevents someone without the right face/
       * fingerprint from even attempting to guess the PIN.
       */}
      {!isLockedOut && stage === 'biometric' && (
        <div className="fade-in" style={{
          textAlign: 'center',
          width: '100%',
          maxWidth: '320px',
        }}>
          {/* Biometric icon — fingerprint SVG inside a frosted glass circle.
           *  This matches the lock icon style above but is larger to emphasize
           *  that this is the primary interaction on the screen. */}
          <div style={{
            width: '96px',
            height: '96px',
            borderRadius: '50%',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow), var(--glass-highlight)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            {/* Fingerprint icon — used for both Face ID and Touch ID because
             *  it's universally recognized as "biometric authentication."
             *  A face icon could be confusing for Touch ID users and vice versa. */}
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
              <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 2 0 3.7.9 4.8 2.3" />
              <path d="M10 12c0 4-1 8-3 10" />
              <path d="M14 12c0 2-.5 4-1.5 6" />
              <path d="M18 12a2 2 0 1 0-4 0c0 3-1 5.5-2.5 8" />
              <path d="M22 12c0 6-4.5 10-9 10" />
            </svg>
          </div>

          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--text-primary)',
          }}>
            {getBiometricType()}
          </h2>

          <p style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
            marginBottom: '32px',
          }}>
            {biometricVerifying
              ? 'Verifying identity...'
              : biometricError
              ? biometricError
              : `Use ${getBiometricType()} to continue`}
          </p>

          {/* Error state — show a Retry button when verification fails.
           *  The user must pass biometrics to proceed; there's no skip option. */}
          {biometricError && !biometricVerifying && (
            <button
              className="glass-btn glass-btn-primary"
              onClick={triggerBiometric}
              style={{ width: '100%' }}
            >
              Retry {getBiometricType()}
            </button>
          )}
        </div>
      )}

      {/* ── Stage 1: PIN entry ──────────────────────────────────── */}
      {!isLockedOut && stage === 'pin' && (
        <>
          <PinPad
            title="Enter your PIN"
            subtitle="Enter your 6-digit PIN to begin"
            onComplete={handlePinComplete}
            error={pinError}
          />
          {/* Show remaining attempts warning after 3+ failures */}
          {failedAttempts >= 3 && failedAttempts < MAX_ATTEMPTS && (
            <p className="lockout-warning fade-in">
              {MAX_ATTEMPTS - failedAttempts} attempt{MAX_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining before lockout
            </p>
          )}
        </>
      )}

      {/* ── Stage 2: Password entry ─────────────────────────────── */}
      {!isLockedOut && stage === 'password' && (
        <div className="fade-in" style={{
          textAlign: 'center',
          width: '100%',
          maxWidth: '320px',
        }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--text-primary)',
          }}>
            Master Password
          </h2>

          <p style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
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
                color: 'var(--error-color)',
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
