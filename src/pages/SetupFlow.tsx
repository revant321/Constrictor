/**
 * SetupFlow — first-time setup wizard.
 *
 * This page walks the user through creating their vault credentials.
 * It's a linear state machine with 5 steps:
 *
 *   1. welcome         → Intro screen explaining what Constrictor is
 *   2. create-pin      → User picks a 6-digit PIN (PinPad)
 *   3. confirm-pin     → User re-enters the same PIN to confirm
 *   4. create-password  → User types a master password
 *   5. confirm-password → User re-types the password to confirm
 *
 * After step 5, we call the `onComplete(pin, password)` callback, which
 * triggers auth.setup() in the parent (via useAuth). The user is then
 * automatically unlocked — no need to re-enter credentials.
 *
 * Why a state machine instead of React Router routes?
 * Because these steps are ephemeral — they only happen once, ever. There's
 * no reason for each step to have its own URL. The user can't bookmark
 * "step 3 of setup" and come back later. A simple useState is the right tool.
 */

import { useState, useCallback, type FormEvent } from 'react'
import PinPad from '../components/PinPad'
import '../styles/glass.css'

type Step = 'welcome' | 'create-pin' | 'confirm-pin' | 'create-password' | 'confirm-password'

interface SetupFlowProps {
  /** Called when all steps are complete. Receives the chosen PIN and password. */
  onComplete: (pin: string, masterPassword: string) => Promise<void>
}

export default function SetupFlow({ onComplete }: SetupFlowProps) {
  // ── State ───────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>('welcome')

  // The chosen PIN — set in "create-pin", verified in "confirm-pin".
  const [pin, setPin] = useState('')

  // The chosen password — set in "create-password", verified in "confirm-password".
  const [password, setPassword] = useState('')

  // The text currently typed in the password input field.
  // This is separate from `password` because `password` is only set when
  // the user submits, while `inputValue` tracks every keystroke for the
  // controlled input.
  const [inputValue, setInputValue] = useState('')

  // Error states for the confirmation steps.
  const [pinError, setPinError] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // Whether we're currently running the setup (PBKDF2 key derivation).
  // True during the ~0.3-0.5s async operation.
  const [loading, setLoading] = useState(false)

  // ── Step Handlers ───────────────────────────────────────────────

  /**
   * Welcome → Create PIN
   * Just advances the step. No data to process.
   */
  const handleWelcomeContinue = useCallback(() => {
    setStep('create-pin')
  }, [])

  /**
   * Create PIN → Confirm PIN
   * Stores the chosen PIN and advances to the confirmation step.
   */
  const handlePinCreated = useCallback((enteredPin: string) => {
    setPin(enteredPin)
    setStep('confirm-pin')
  }, [])

  /**
   * Confirm PIN
   * Compares the entered PIN against the stored PIN.
   *   - Match → advance to password creation
   *   - Mismatch → show error (shake + red dots), user retries
   *
   * On mismatch, we stay on "confirm-pin" — the PinPad will clear itself
   * when it sees the error prop change to true.
   */
  const handlePinConfirmed = useCallback((enteredPin: string) => {
    if (enteredPin === pin) {
      // PINs match — move to password step.
      setStep('create-password')
      setInputValue('')
    } else {
      // PINs don't match — trigger error animation.
      // We toggle pinError to true, then back to false after a short delay
      // so the PinPad's useEffect detects the change if they fail again.
      setPinError(true)
      setTimeout(() => setPinError(false), 600)
    }
  }, [pin])

  /**
   * Create Password → Confirm Password
   * Validates the password meets minimum requirements, then advances.
   *
   * We require at least 8 characters. This is the only validation —
   * we don't enforce uppercase/numbers/symbols because overly complex
   * password rules often lead to WORSE passwords (users write them down
   * or pick predictable patterns to satisfy the rules).
   */
  const handlePasswordCreated = useCallback((e: FormEvent) => {
    e.preventDefault()

    if (inputValue.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    setPassword(inputValue)
    setInputValue('')
    setPasswordError('')
    setStep('confirm-password')
  }, [inputValue])

  /**
   * Confirm Password → Setup Complete
   * Checks that the re-entered password matches, then calls onComplete.
   *
   * onComplete is async (it triggers PBKDF2 key derivation), so we show
   * a loading state during the ~0.3-0.5s wait.
   */
  const handlePasswordConfirmed = useCallback(async (e: FormEvent) => {
    e.preventDefault()

    if (inputValue !== password) {
      setPasswordError('Passwords don\'t match')
      return
    }

    // Everything checks out — create the vault.
    setPasswordError('')
    setLoading(true)

    try {
      await onComplete(pin, password)
      // After this, the AuthProvider sets status to "unlocked" and the
      // SetupFlow component unmounts — we never reach the next line.
    } catch {
      setLoading(false)
      setPasswordError('Something went wrong. Please try again.')
    }
  }, [inputValue, password, pin, onComplete])

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="screen-center">
      {/* ─── Step 1: Welcome ─────────────────────────────────────── */}
      {step === 'welcome' && (
        <div className="fade-in" style={{ textAlign: 'center', maxWidth: 340 }}>
          {/* App icon — SVG lock inside a frosted glass circle */}
          <div style={{
            width: '88px',
            height: '88px',
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
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <h1 style={{
            fontSize: '28px',
            fontWeight: 700,
            marginBottom: '12px',
            color: 'var(--text-primary)',
          }}>
            Welcome to Constrictor
          </h1>

          <p style={{
            fontSize: '16px',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            marginBottom: '16px',
          }}>
            A secure, local-first password manager. Your data never leaves this device.
          </p>

          {/* Warning about no recovery — this is the most important thing
           *  for the user to understand before they start. */}
          <div className="glass-card" style={{
            marginBottom: '32px',
            padding: '16px',
            textAlign: 'left',
          }}>
            <p style={{
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
            }}>
              <strong style={{ color: 'var(--error-color)' }}>No recovery.</strong>{' '}
              If you forget your PIN or master password, your data cannot be recovered. This is by design — it means no one else can recover it either.
            </p>
          </div>

          <button
            className="glass-btn glass-btn-primary"
            onClick={handleWelcomeContinue}
            style={{ width: '100%' }}
          >
            Get Started
          </button>
        </div>
      )}

      {/* ─── Step 2: Create PIN ──────────────────────────────────── */}
      {step === 'create-pin' && (
        <PinPad
          title="Create your PIN"
          subtitle="Choose a 6-digit PIN"
          onComplete={handlePinCreated}
        />
      )}

      {/* ─── Step 3: Confirm PIN ─────────────────────────────────── */}
      {step === 'confirm-pin' && (
        <PinPad
          title="Confirm your PIN"
          subtitle="Enter the same PIN again"
          onComplete={handlePinConfirmed}
          error={pinError}
        />
      )}

      {/* ─── Step 4: Create Password ─────────────────────────────── */}
      {step === 'create-password' && (
        <div className="fade-in" style={{ textAlign: 'center', maxWidth: 340, width: '100%' }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--text-primary)',
          }}>
            Create master password
          </h2>
          <p style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
            marginBottom: '32px',
          }}>
            At least 8 characters. Make it memorable — there's no reset.
          </p>

          <form onSubmit={handlePasswordCreated}>
            <input
              type="password"
              className="glass-input"
              placeholder="Master password"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              autoFocus
              autoComplete="new-password"
              style={{ marginBottom: '16px' }}
            />

            {/* Error message — shown when password is too short */}
            {passwordError && (
              <p style={{
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
              disabled={inputValue.length === 0}
              style={{ width: '100%' }}
            >
              Continue
            </button>
          </form>
        </div>
      )}

      {/* ─── Step 5: Confirm Password ────────────────────────────── */}
      {step === 'confirm-password' && (
        <div className="fade-in" style={{ textAlign: 'center', maxWidth: 340, width: '100%' }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--text-primary)',
          }}>
            Confirm master password
          </h2>
          <p style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
            marginBottom: '32px',
          }}>
            Enter it one more time to make sure.
          </p>

          <form onSubmit={handlePasswordConfirmed}>
            <input
              type="password"
              className="glass-input"
              placeholder="Confirm password"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              autoFocus
              autoComplete="new-password"
              style={{ marginBottom: '16px' }}
            />

            {passwordError && (
              <p style={{
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
              disabled={inputValue.length === 0 || loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Setting up...' : 'Complete Setup'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
