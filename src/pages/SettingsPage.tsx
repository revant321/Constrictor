/**
 * SettingsPage — Phase 5 settings panel.
 *
 * Features:
 *   1. Lock behavior toggle — switch between "Lock on close" and "Lock on background"
 *   2. Change PIN — multi-step flow: verify creds → new PIN → confirm → re-encrypt
 *   3. Change master password — same flow but for the password
 *   4. Lock Now — immediately wipes the key and returns to lock screen
 *
 * Architecture:
 *   The main view shows a list of settings sections styled as glass cards.
 *   "Change PIN" and "Change master password" open sub-views within the
 *   same overlay — they don't push a new route, they just swap what's
 *   rendered in the settings panel. Each sub-view is a multi-step wizard
 *   that reuses the PinPad component from the setup/lock screen.
 *
 * The trickiest part is the credential change flow:
 *   - The user must first prove they know their current credentials
 *   - Then enter and confirm the new credential
 *   - We derive a new encryption key and re-encrypt every field in the vault
 *   - This is all handled by changePin/changePassword in auth.ts
 *
 * State machine for sub-views:
 *   'main'           → the settings list
 *   'change-pin'     → the change PIN wizard
 *   'change-password' → the change password wizard
 *
 * Within each wizard, steps are tracked by a numeric state variable.
 */

import { useState, useEffect, useRef } from 'react'
import PinPad from '../components/PinPad'
import {
  getLockBehavior,
  setLockBehavior,
  changePin,
  changePassword,
  getNoteSortMode,
  setNoteSortMode,
  type NoteSortMode,
} from '../services/auth'
import {
  canUseBiometrics,
  isBiometricsEnabled,
  enrollBiometric,
  disableBiometric,
  getBiometricType,
} from '../services/biometrics'
import { db } from '../services/db'
import { exportVault, importVault } from '../services/vault'
import { useAuth } from '../hooks/useAuth'
import { useTheme, type Appearance } from '../hooks/useTheme'
import { useServiceWorker } from '../hooks/useServiceWorker'
import '../styles/glass.css'

type SettingsView = 'main' | 'change-pin' | 'change-password' | 'import-vault'

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const { lock } = useAuth()
  const { appearance, setAppearance } = useTheme()
  const { updateAvailable, updateDismissed, acceptUpdate } = useServiceWorker()

  // ─── Lock behavior state ──────────────────────────────────────────
  const [lockBehavior, setLockBehaviorState] = useState<'close' | 'background'>('close')

  useEffect(() => {
    getLockBehavior().then(setLockBehaviorState)
  }, [])

  const handleToggleLockBehavior = async () => {
    const newBehavior = lockBehavior === 'close' ? 'background' : 'close'
    await setLockBehavior(newBehavior)
    setLockBehaviorState(newBehavior)
  }

  // ─── Note sort mode state (Phase 8) ──────────────────────────────
  //
  // Two options: 'date' (default, sort by dateModified) or 'manual'
  // (user-defined order via drag). When switching to 'manual' for the
  // first time, we assign order values to all existing notes based on
  // their current date-sorted positions — this preserves the user's
  // perceived order as a starting point for manual reordering.

  const [noteSortMode, setNoteSortModeState] = useState<NoteSortMode>('date')

  useEffect(() => {
    getNoteSortMode().then(setNoteSortModeState)
  }, [])

  const handleSetSortMode = async (mode: NoteSortMode) => {
    if (mode === 'manual') {
      // Check if any notes have order values already. If not, this is
      // the first time switching to manual — initialize order values.
      const notes = await db.notes.toArray()
      const needsInit = notes.some(n => n.order === undefined || n.order === null)

      if (needsInit) {
        // Sort by dateModified descending (current display order),
        // then assign sequential order values starting at 0.
        const sorted = [...notes].sort((a, b) => b.dateModified - a.dateModified)
        await Promise.all(
          sorted.map((note, index) =>
            db.notes.update(note.id!, { order: index })
          )
        )
      }
    }

    await setNoteSortMode(mode)
    setNoteSortModeState(mode)
  }

  // ─── Biometric unlock state ────────────────────────────────────────
  //
  // Three pieces of state:
  //   - deviceSupportsBiometrics: whether the hardware + browser support it.
  //     If false, we hide the toggle entirely (no point showing an option
  //     the user can't use). Checked once on mount via canUseBiometrics().
  //
  //   - biometricsEnabled: whether the user has turned it on. Read from the
  //     database on mount.
  //
  //   - biometricToggling: true while the WebAuthn enrollment prompt is active.
  //     Prevents the toggle from being clicked again during the Face ID /
  //     Touch ID dialog.

  const [deviceSupportsBiometrics, setDeviceSupportsBiometrics] = useState(false)
  const [biometricsEnabled, setBiometricsEnabled] = useState(false)
  const [biometricToggling, setBiometricToggling] = useState(false)
  const [biometricToast, setBiometricToast] = useState<'success' | 'error' | null>(null)
  const [biometricToastMessage, setBiometricToastMessage] = useState('')

  useEffect(() => {
    // Check both device capability and current enabled state in parallel.
    Promise.all([canUseBiometrics(), isBiometricsEnabled()]).then(
      ([capable, enabled]) => {
        setDeviceSupportsBiometrics(capable)
        setBiometricsEnabled(enabled)
      }
    )
  }, [])

  /**
   * Toggle handler for biometric unlock.
   *
   * Enabling: triggers WebAuthn credential creation (Face ID / Touch ID prompt).
   *   If the user completes the biometric prompt, the credential is stored
   *   and the flag is set. If they cancel or it fails, we show an error toast.
   *
   * Disabling: just clears the database entries. No biometric prompt needed
   *   because the user is already unlocked (they passed PIN + password to
   *   get into Settings).
   */
  const handleToggleBiometrics = async () => {
    if (biometricToggling) return

    if (biometricsEnabled) {
      // Disabling — simple database cleanup.
      await disableBiometric()
      setBiometricsEnabled(false)
      return
    }

    // Enabling — trigger the WebAuthn enrollment flow.
    setBiometricToggling(true)
    try {
      await enrollBiometric()
      setBiometricsEnabled(true)
      setBiometricToast('success')
      setBiometricToastMessage(`${getBiometricType()} enabled`)
    } catch {
      setBiometricToast('error')
      setBiometricToastMessage('Biometric setup failed')
    } finally {
      setBiometricToggling(false)
      setTimeout(() => setBiometricToast(null), 3000)
    }
  }

  // ─── Sub-view navigation ──────────────────────────────────────────
  const [view, setView] = useState<SettingsView>('main')

  // ─── Change PIN wizard state ──────────────────────────────────────
  //
  // The Change PIN flow has 4 steps:
  //   0: Enter current PIN (pin pad)
  //   1: Enter current master password (text input)
  //   2: Enter new PIN (pin pad)
  //   3: Confirm new PIN (pin pad)
  //
  // After step 3, we call changePin() which re-derives the key and
  // re-encrypts the entire vault. During this process we show a
  // "processing" state.

  const [pinStep, setPinStep] = useState(0)
  const [currentPin, setCurrentPin] = useState('')
  const [currentPasswordForPin, setCurrentPasswordForPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [pinProcessing, setPinProcessing] = useState(false)
  const [pinSuccess, setPinSuccess] = useState(false)
  const [pinErrorMessage, setPinErrorMessage] = useState('')

  const resetPinWizard = () => {
    setPinStep(0)
    setCurrentPin('')
    setCurrentPasswordForPin('')
    setNewPin('')
    setPinError(false)
    setPinProcessing(false)
    setPinSuccess(false)
    setPinErrorMessage('')
  }

  // ─── Change Password wizard state ─────────────────────────────────
  //
  // The Change Password flow:
  //   0: Enter current PIN (pin pad)
  //   1: Enter current master password (text input)
  //   2: Enter new master password (text input)
  //   3: Confirm new master password (text input)

  const [passStep, setPassStep] = useState(0)
  const [currentPinForPass, setCurrentPinForPass] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passProcessing, setPassProcessing] = useState(false)
  const [passSuccess, setPassSuccess] = useState(false)
  const [passErrorMessage, setPassErrorMessage] = useState('')

  const resetPassWizard = () => {
    setPassStep(0)
    setCurrentPinForPass('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPassProcessing(false)
    setPassSuccess(false)
    setPassErrorMessage('')
  }

  // ─── Export state ─────────────────────────────────────────────────
  //
  // Export is a one-click action — no wizard needed. We just show brief
  // feedback: "Exporting..." → "Exported!" or an error message.
  // The toast auto-dismisses after 3 seconds.

  const [exporting, setExporting] = useState(false)
  const [exportToast, setExportToast] = useState<'success' | 'error' | null>(null)
  const [exportError, setExportError] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setExportToast(null)
    try {
      await exportVault()
      setExportToast('success')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
      setExportToast('error')
    } finally {
      setExporting(false)
      // Auto-dismiss toast after 3 seconds.
      setTimeout(() => setExportToast(null), 3000)
    }
  }

  // ─── Import wizard state ──────────────────────────────────────────
  //
  // The import flow:
  //   1. User clicks "Import Vault" → hidden file input opens
  //   2. File selected → validate it's parseable JSON with version field
  //   3. Navigate to 'import-vault' view
  //   4. Step 0: Enter source PIN (from the device that exported the file)
  //   5. Step 1: Enter source password
  //   6. Submit → decrypt with source creds, re-encrypt with local key, merge
  //   7. Show success (with counts) or error
  //
  // We need the source credentials because the file was encrypted with THAT
  // device's key (derived from THAT device's PIN + password + salt).

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importFileContent, setImportFileContent] = useState<string | null>(null)
  const [importStep, setImportStep] = useState(0) // 0=pin, 1=password
  const [importPin, setImportPin] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [importProcessing, setImportProcessing] = useState(false)
  const [importSuccess, setImportSuccess] = useState<{
    passwords: number; notes: number; categories: number
  } | null>(null)
  const [importError, setImportError] = useState('')

  const resetImportWizard = () => {
    setImportFileContent(null)
    setImportStep(0)
    setImportPin('')
    setImportPassword('')
    setImportProcessing(false)
    setImportSuccess(null)
    setImportError('')
  }

  /** Called when the user picks a file from the file input. */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const content = reader.result as string
      // Quick validation: check it's valid JSON with a version field.
      try {
        const parsed = JSON.parse(content)
        if (parsed.version !== 1 || !parsed.salt || !parsed.iv || !parsed.data) {
          setImportError('Invalid .constrictor file format')
          setExportToast('error')
          setExportError('Invalid .constrictor file format')
          setTimeout(() => setExportToast(null), 3000)
          return
        }
      } catch {
        setImportError('File is not valid JSON')
        setExportToast('error')
        setExportError('File is not valid JSON')
        setTimeout(() => setExportToast(null), 3000)
        return
      }

      // File is valid — start the import wizard.
      setImportFileContent(content)
      resetImportWizard()
      setImportFileContent(content) // re-set after reset clears it
      setView('import-vault')
    }
    reader.readAsText(file)

    // Reset the input so selecting the same file again triggers onChange.
    e.target.value = ''
  }

  /** PIN entered for source device credentials. */
  const handleImportPinComplete = (pin: string) => {
    setImportPin(pin)
    setImportStep(1)
  }

  /** Source password submitted — perform the actual import. */
  const handleImportSubmit = async () => {
    if (!importPassword.trim() || !importFileContent) return

    setImportProcessing(true)
    setImportError('')

    try {
      const counts = await importVault(importFileContent, importPin, importPassword)
      setImportSuccess(counts)
    } catch (err) {
      // The most likely error: wrong credentials (AES-GCM auth tag mismatch).
      // We show the error and reset to step 0 so they can re-enter both credentials.
      setImportError(
        err instanceof Error ? err.message : 'Import failed',
      )
      setImportStep(0)
      setImportPin('')
      setImportPassword('')
    } finally {
      setImportProcessing(false)
    }
  }

  // ─── Change PIN handlers ──────────────────────────────────────────

  const handlePinStep0Complete = (pin: string) => {
    setCurrentPin(pin)
    setPinStep(1)
  }

  const handlePinStep1Submit = () => {
    if (currentPasswordForPin.length === 0) return
    setPinStep(2)
  }

  const handlePinStep2Complete = (pin: string) => {
    setNewPin(pin)
    setPinStep(3)
  }

  const handlePinStep3Complete = async (confirmPin: string) => {
    // Check that the confirmed PIN matches the new PIN.
    if (confirmPin !== newPin) {
      setPinError(true)
      // After the shake animation (500ms), reset the error flag.
      setTimeout(() => setPinError(false), 600)
      return
    }

    // PINs match — now do the heavy lifting: verify old creds, re-derive
    // key, and re-encrypt everything. This can take a few seconds.
    setPinProcessing(true)
    setPinErrorMessage('')

    const success = await changePin(currentPin, currentPasswordForPin, newPin)

    setPinProcessing(false)

    if (success) {
      setPinSuccess(true)
    } else {
      // If changePin returns false, the current credentials were wrong.
      // This means the user entered the wrong PIN or password in steps 0/1.
      setPinErrorMessage('Current credentials are incorrect. Please try again.')
      // Go back to the start of the wizard so they can re-enter.
      setPinStep(0)
      setCurrentPin('')
      setCurrentPasswordForPin('')
      setNewPin('')
    }
  }

  // ─── Change Password handlers ─────────────────────────────────────

  const handlePassStep0Complete = (pin: string) => {
    setCurrentPinForPass(pin)
    setPassStep(1)
  }

  const handlePassStep1Submit = () => {
    if (currentPassword.length === 0) return
    setPassStep(2)
  }

  const handlePassStep2Submit = () => {
    if (newPassword.length < 1) return
    setPassStep(3)
  }

  const handlePassStep3Submit = async () => {
    if (confirmPassword !== newPassword) {
      setPassErrorMessage('Passwords do not match.')
      return
    }

    setPassProcessing(true)
    setPassErrorMessage('')

    const success = await changePassword(currentPinForPass, currentPassword, newPassword)

    setPassProcessing(false)

    if (success) {
      setPassSuccess(true)
    } else {
      setPassErrorMessage('Current credentials are incorrect. Please try again.')
      setPassStep(0)
      setCurrentPinForPass('')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  // ─── Render helpers ───────────────────────────────────────────────

  const renderBackButton = (onClick: () => void, label = 'Settings') => (
    <button className="detail-back" onClick={onClick}>
      <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  )

  // ─── MAIN SETTINGS VIEW ───────────────────────────────────────────

  if (view === 'main') {
    return (
      <>
        <div className="detail-header">
          {renderBackButton(onClose, 'Back')}
        </div>
        <div className="detail-body">
          <div className="page-header" style={{ paddingLeft: 0 }}>
            <h1 className="page-title">Settings</h1>
          </div>

          {/* ── App Update Card ────────────────────────────────────────
           *
           * Only shown when the user dismissed the update prompt ("Not Now").
           * Tapping it sends SKIP_WAITING to the waiting SW, same as the
           * "Accept" button on the prompt. The card disappears when there's
           * no update or the user hasn't dismissed the prompt yet (because
           * the modal prompt handles it in that case).
           */}
          {updateAvailable && updateDismissed && (
            <div className="settings-section">
              <div
                className="glass-card settings-card settings-card-tappable settings-update-card"
                onClick={acceptUpdate}
              >
                <div className="settings-row">
                  <div className="settings-row-icon">
                    <svg viewBox="0 0 24 24">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <div className="settings-row-text">
                    <div className="settings-row-label">App Update Available</div>
                    <div className="settings-row-description">
                      Tap to update and reload
                    </div>
                  </div>
                  <div className="settings-row-chevron">
                    <svg viewBox="0 0 24 24">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Appearance Section ───────────────────────────────────
           *
           * Three-way segmented control: System / Light / Dark.
           * "System" (default) follows the OS preference via prefers-color-scheme.
           * The choice is persisted in Dexie's meta table so it survives app restarts.
           */}
          <div className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>

            <div className="glass-card settings-card">
              <div className="settings-row-text" style={{ marginBottom: '12px' }}>
                <div className="settings-row-label">Theme</div>
                <div className="settings-row-description">
                  {appearance === 'system'
                    ? 'Follows your device settings'
                    : appearance === 'light'
                    ? 'Always use light mode'
                    : 'Always use dark mode'}
                </div>
              </div>
              <div className="appearance-segment">
                {(['system', 'light', 'dark'] as Appearance[]).map((opt) => (
                  <button
                    key={opt}
                    className={`appearance-segment-btn${appearance === opt ? ' active' : ''}`}
                    onClick={() => setAppearance(opt)}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Biometric Unlock Section (Phase 9) ─────────────────────
           *
           * Only rendered if the device supports platform biometrics
           * (Face ID on iPhone, Touch ID on Mac). If the hardware doesn't
           * support it or the page isn't served over HTTPS, this section
           * is completely hidden — no confusing greyed-out toggles.
           *
           * The toggle triggers WebAuthn credential creation when enabling
           * (which shows the Face ID / Touch ID prompt), and just clears
           * the database when disabling (no prompt needed since the user
           * is already authenticated).
           */}
          {deviceSupportsBiometrics && (
            <div className="settings-section">
              <h3 className="settings-section-title">Biometric Unlock</h3>

              <div className="glass-card settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">{getBiometricType()}</div>
                    <div className="settings-row-description">
                      Require {getBiometricType()} as the first step before PIN and password
                    </div>
                  </div>
                  <button
                    className={`settings-toggle ${biometricsEnabled ? 'active' : ''}`}
                    onClick={handleToggleBiometrics}
                    disabled={biometricToggling}
                    aria-label={`${biometricsEnabled ? 'Disable' : 'Enable'} ${getBiometricType()}`}
                    style={biometricToggling ? { opacity: 0.5 } : undefined}
                  >
                    <div className="settings-toggle-knob" />
                  </button>
                </div>
              </div>

              {/* Toast feedback for biometric enrollment/disable */}
              {biometricToast && (
                <div className={`settings-toast fade-in ${biometricToast === 'error' ? 'settings-toast-error' : ''}`}>
                  {biometricToastMessage}
                </div>
              )}
            </div>
          )}

          {/* ── Notes Section (Phase 8) ────────────────────────────────
           *
           * Sort mode toggle: Date (default) vs Manual.
           * Uses the same segmented control pattern as the Appearance toggle.
           * Date mode sorts notes by last modified (newest first).
           * Manual mode lets users drag-reorder notes and categories.
           */}
          <div className="settings-section">
            <h3 className="settings-section-title">Notes</h3>

            <div className="glass-card settings-card">
              <div className="settings-row-text" style={{ marginBottom: '12px' }}>
                <div className="settings-row-label">Sort order</div>
                <div className="settings-row-description">
                  {noteSortMode === 'date'
                    ? 'Notes sorted by date last edited'
                    : 'Notes in custom order — drag to rearrange'}
                </div>
              </div>
              <div className="appearance-segment">
                {(['date', 'manual'] as NoteSortMode[]).map((opt) => (
                  <button
                    key={opt}
                    className={`appearance-segment-btn${noteSortMode === opt ? ' active' : ''}`}
                    onClick={() => handleSetSortMode(opt)}
                  >
                    {opt === 'date' ? 'Date' : 'Manual'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Lock Behavior Toggle */}
          <div className="settings-section">
            <h3 className="settings-section-title">Security</h3>

            <div className="glass-card settings-card">
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Lock behavior</div>
                  <div className="settings-row-description">
                    {lockBehavior === 'close'
                      ? 'Locks when app is closed or terminated'
                      : 'Locks when app goes to background'}
                  </div>
                </div>
                <button
                  className={`settings-toggle ${lockBehavior === 'background' ? 'active' : ''}`}
                  onClick={handleToggleLockBehavior}
                  aria-label={`Lock on ${lockBehavior === 'close' ? 'close' : 'background'}`}
                >
                  <div className="settings-toggle-knob" />
                </button>
              </div>
            </div>

            {/* Change PIN */}
            <div
              className="glass-card settings-card settings-card-tappable"
              onClick={() => { resetPinWizard(); setView('change-pin') }}
            >
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Change PIN</div>
                  <div className="settings-row-description">
                    Update your 6-digit PIN
                  </div>
                </div>
                <div className="settings-row-chevron">
                  <svg viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Change Master Password */}
            <div
              className="glass-card settings-card settings-card-tappable"
              onClick={() => { resetPassWizard(); setView('change-password') }}
            >
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Change master password</div>
                  <div className="settings-row-description">
                    Update your master password
                  </div>
                </div>
                <div className="settings-row-chevron">
                  <svg viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* ── Data Section — Export & Import ─────────────────────
           *
           * Export: One-click download. Serializes the entire vault, encrypts
           * it as a single blob, and triggers a .constrictor file download.
           *
           * Import: Opens a file picker, then walks through a mini-wizard
           * to collect the source device's credentials (needed to decrypt
           * the file). After decryption, entries are re-encrypted with the
           * local key and merged into the vault.
           *
           * The hidden <input type="file"> is triggered programmatically
           * when the user clicks the Import card. This is a common pattern
           * for custom-styled file inputs — the native file input is ugly
           * and can't be styled, so we hide it and use a nicer UI element.
           */}
          <div className="settings-section">
            <h3 className="settings-section-title">Data</h3>

            {/* Export Vault */}
            <div
              className={`glass-card settings-card settings-card-tappable ${exporting ? 'settings-card-disabled' : ''}`}
              onClick={exporting ? undefined : handleExport}
            >
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">
                    {exporting ? 'Exporting...' : 'Export vault'}
                  </div>
                  <div className="settings-row-description">
                    Download an encrypted .constrictor backup file
                  </div>
                </div>
                <div className="settings-row-icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Import Vault */}
            <div
              className="glass-card settings-card settings-card-tappable"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="settings-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Import vault</div>
                  <div className="settings-row-description">
                    Merge entries from a .constrictor file
                  </div>
                </div>
                <div className="settings-row-icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Hidden file input — triggered by the Import card click */}
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {/* Export toast — brief feedback after export */}
            {exportToast && (
              <div className={`settings-toast fade-in ${exportToast === 'error' ? 'settings-toast-error' : ''}`}>
                {exportToast === 'success'
                  ? 'Vault exported successfully'
                  : exportError}
              </div>
            )}
          </div>

          {/* Lock Now Button */}
          <div className="settings-section">
            <button
              className="glass-btn settings-lock-btn"
              onClick={lock}
            >
              <svg viewBox="0 0 24 24" className="settings-lock-icon">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Lock Now
            </button>
          </div>

          {/* Version info — small footer */}
          <div className="settings-footer">
            Constrictor v2.0 — Added Face ID + Touch ID
          </div>
        </div>
      </>
    )
  }

  // ─── CHANGE PIN VIEW ──────────────────────────────────────────────

  if (view === 'change-pin') {
    // Success state — show confirmation and a button to go back.
    if (pinSuccess) {
      return (
        <>
          <div className="detail-header">
            {renderBackButton(() => { resetPinWizard(); setView('main') })}
          </div>
          <div className="detail-body">
            <div className="settings-success fade-in">
              <div className="settings-success-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h2 className="settings-success-title">PIN Changed</h2>
              <p className="settings-success-subtitle">
                Your PIN has been updated and all vault data has been re-encrypted with your new credentials.
              </p>
              <button
                className="glass-btn glass-btn-primary"
                onClick={() => { resetPinWizard(); setView('main') }}
                style={{ marginTop: '24px', width: '100%' }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )
    }

    // Processing state — show spinner while re-encrypting.
    if (pinProcessing) {
      return (
        <>
          <div className="detail-header">
            <div />
          </div>
          <div className="detail-body">
            <div className="settings-processing">
              <div className="settings-spinner" />
              <h2 className="settings-processing-title">Re-encrypting vault...</h2>
              <p className="settings-processing-subtitle">
                Deriving new key and re-encrypting all entries. This may take a moment.
              </p>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="detail-header">
          {renderBackButton(() => {
            // If we're past step 0, go back one step. Otherwise, return to main.
            if (pinStep > 0) {
              setPinStep(pinStep - 1)
              // Clear the data for the step we're leaving.
              if (pinStep === 1) setCurrentPasswordForPin('')
              if (pinStep === 2) { /* nothing to clear, just go back */ }
              if (pinStep === 3) setNewPin('')
            } else {
              resetPinWizard()
              setView('main')
            }
          })}
        </div>
        <div className="detail-body">
          <div className="page-header" style={{ paddingLeft: 0 }}>
            <h1 className="page-title">Change PIN</h1>
          </div>

          {/* Error message from failed verification */}
          {pinErrorMessage && (
            <div className="settings-error-banner fade-in">
              {pinErrorMessage}
            </div>
          )}

          {/* Step 0: Enter current PIN */}
          {pinStep === 0 && (
            <div className="settings-wizard-step">
              <PinPad
                title="Enter current PIN"
                subtitle="Verify your identity before making changes"
                onComplete={handlePinStep0Complete}
                error={false}
              />
            </div>
          )}

          {/* Step 1: Enter current master password */}
          {pinStep === 1 && (
            <div className="settings-wizard-step fade-in">
              <div className="settings-password-step">
                <h2 className="settings-step-title">Enter current password</h2>
                <p className="settings-step-subtitle">
                  Verify your master password to continue
                </p>
                <div className="form-group" style={{ marginTop: '24px' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Master password"
                    value={currentPasswordForPin}
                    onChange={e => setCurrentPasswordForPin(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handlePinStep1Submit() }}
                    autoFocus
                  />
                </div>
                <button
                  className="glass-btn glass-btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  disabled={currentPasswordForPin.length === 0}
                  onClick={handlePinStep1Submit}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Enter new PIN */}
          {pinStep === 2 && (
            <div className="settings-wizard-step">
              <PinPad
                title="Enter new PIN"
                subtitle="Choose a new 6-digit PIN"
                onComplete={handlePinStep2Complete}
                error={false}
              />
            </div>
          )}

          {/* Step 3: Confirm new PIN */}
          {pinStep === 3 && (
            <div className="settings-wizard-step">
              <PinPad
                title="Confirm new PIN"
                subtitle="Enter the same PIN again"
                onComplete={handlePinStep3Complete}
                error={pinError}
              />
            </div>
          )}
        </div>
      </>
    )
  }

  // ─── CHANGE PASSWORD VIEW ─────────────────────────────────────────

  if (view === 'change-password') {
    // Success state
    if (passSuccess) {
      return (
        <>
          <div className="detail-header">
            {renderBackButton(() => { resetPassWizard(); setView('main') })}
          </div>
          <div className="detail-body">
            <div className="settings-success fade-in">
              <div className="settings-success-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h2 className="settings-success-title">Password Changed</h2>
              <p className="settings-success-subtitle">
                Your master password has been updated and all vault data has been re-encrypted with your new credentials.
              </p>
              <button
                className="glass-btn glass-btn-primary"
                onClick={() => { resetPassWizard(); setView('main') }}
                style={{ marginTop: '24px', width: '100%' }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )
    }

    // Processing state
    if (passProcessing) {
      return (
        <>
          <div className="detail-header">
            <div />
          </div>
          <div className="detail-body">
            <div className="settings-processing">
              <div className="settings-spinner" />
              <h2 className="settings-processing-title">Re-encrypting vault...</h2>
              <p className="settings-processing-subtitle">
                Deriving new key and re-encrypting all entries. This may take a moment.
              </p>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="detail-header">
          {renderBackButton(() => {
            if (passStep > 0) {
              setPassStep(passStep - 1)
              if (passStep === 1) setCurrentPassword('')
              if (passStep === 2) setNewPassword('')
              if (passStep === 3) setConfirmPassword('')
            } else {
              resetPassWizard()
              setView('main')
            }
          })}
        </div>
        <div className="detail-body">
          <div className="page-header" style={{ paddingLeft: 0 }}>
            <h1 className="page-title">Change Password</h1>
          </div>

          {passErrorMessage && (
            <div className="settings-error-banner fade-in">
              {passErrorMessage}
            </div>
          )}

          {/* Step 0: Enter current PIN */}
          {passStep === 0 && (
            <div className="settings-wizard-step">
              <PinPad
                title="Enter current PIN"
                subtitle="Verify your identity before making changes"
                onComplete={handlePassStep0Complete}
                error={false}
              />
            </div>
          )}

          {/* Step 1: Enter current master password */}
          {passStep === 1 && (
            <div className="settings-wizard-step fade-in">
              <div className="settings-password-step">
                <h2 className="settings-step-title">Enter current password</h2>
                <p className="settings-step-subtitle">
                  Verify your master password to continue
                </p>
                <div className="form-group" style={{ marginTop: '24px' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Current master password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handlePassStep1Submit() }}
                    autoFocus
                  />
                </div>
                <button
                  className="glass-btn glass-btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  disabled={currentPassword.length === 0}
                  onClick={handlePassStep1Submit}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Enter new master password */}
          {passStep === 2 && (
            <div className="settings-wizard-step fade-in">
              <div className="settings-password-step">
                <h2 className="settings-step-title">New master password</h2>
                <p className="settings-step-subtitle">
                  Choose a strong, memorable password
                </p>
                <div className="form-group" style={{ marginTop: '24px' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="New master password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handlePassStep2Submit() }}
                    autoFocus
                  />
                </div>
                <button
                  className="glass-btn glass-btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  disabled={newPassword.length === 0}
                  onClick={handlePassStep2Submit}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm new master password */}
          {passStep === 3 && (
            <div className="settings-wizard-step fade-in">
              <div className="settings-password-step">
                <h2 className="settings-step-title">Confirm new password</h2>
                <p className="settings-step-subtitle">
                  Enter the same password again
                </p>
                <div className="form-group" style={{ marginTop: '24px' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setPassErrorMessage('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handlePassStep3Submit() }}
                    autoFocus
                  />
                </div>
                {passErrorMessage && (
                  <div className="settings-inline-error">{passErrorMessage}</div>
                )}
                <button
                  className="glass-btn glass-btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  disabled={confirmPassword.length === 0}
                  onClick={handlePassStep3Submit}
                >
                  Change Password
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  // ─── IMPORT VAULT VIEW ──────────────────────────────────────────
  //
  // A mini-wizard that collects the SOURCE device's credentials.
  // The user must enter the PIN + master password that were active on
  // the device that exported the .constrictor file. This is necessary
  // because the file was encrypted with that device's derived key.

  if (view === 'import-vault') {
    // Success state — show counts of imported entries.
    if (importSuccess) {
      const total = importSuccess.passwords + importSuccess.notes + importSuccess.categories
      return (
        <>
          <div className="detail-header">
            {renderBackButton(() => { resetImportWizard(); setView('main') })}
          </div>
          <div className="detail-body">
            <div className="settings-success fade-in">
              <div className="settings-success-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h2 className="settings-success-title">Import Complete</h2>
              <p className="settings-success-subtitle">
                {total === 0
                  ? 'The file contained no entries to import.'
                  : `Imported ${importSuccess.passwords} password${importSuccess.passwords !== 1 ? 's' : ''}, ${importSuccess.notes} note${importSuccess.notes !== 1 ? 's' : ''}, and ${importSuccess.categories} categor${importSuccess.categories !== 1 ? 'ies' : 'y'}.`}
              </p>
              <p className="settings-success-detail">
                All entries were re-encrypted with your local credentials.
              </p>
              <button
                className="glass-btn glass-btn-primary"
                onClick={() => { resetImportWizard(); setView('main') }}
                style={{ marginTop: '24px', width: '100%' }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )
    }

    // Processing state — decrypting source file + re-encrypting for local vault.
    if (importProcessing) {
      return (
        <>
          <div className="detail-header">
            <div />
          </div>
          <div className="detail-body">
            <div className="settings-processing">
              <div className="settings-spinner" />
              <h2 className="settings-processing-title">Importing vault...</h2>
              <p className="settings-processing-subtitle">
                Decrypting file, re-encrypting entries with your local credentials.
              </p>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="detail-header">
          {renderBackButton(() => {
            if (importStep > 0) {
              setImportStep(importStep - 1)
              if (importStep === 1) setImportPassword('')
            } else {
              resetImportWizard()
              setView('main')
            }
          })}
        </div>
        <div className="detail-body">
          <div className="page-header" style={{ paddingLeft: 0 }}>
            <h1 className="page-title">Import Vault</h1>
          </div>

          {importError && (
            <div className="settings-error-banner fade-in">
              {importError}
            </div>
          )}

          {/* Step 0: Enter source device PIN */}
          {importStep === 0 && (
            <div className="settings-wizard-step">
              <PinPad
                title="Source device PIN"
                subtitle="Enter the PIN that was used on the device that created this file"
                onComplete={handleImportPinComplete}
                error={false}
              />
            </div>
          )}

          {/* Step 1: Enter source device master password */}
          {importStep === 1 && (
            <div className="settings-wizard-step fade-in">
              <div className="settings-password-step">
                <h2 className="settings-step-title">Source device password</h2>
                <p className="settings-step-subtitle">
                  Enter the master password from the device that created this file
                </p>
                <div className="form-group" style={{ marginTop: '24px' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Master password"
                    value={importPassword}
                    onChange={e => setImportPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleImportSubmit() }}
                    autoFocus
                  />
                </div>
                <button
                  className="glass-btn glass-btn-primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  disabled={importPassword.length === 0}
                  onClick={handleImportSubmit}
                >
                  Import
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  return null
}
