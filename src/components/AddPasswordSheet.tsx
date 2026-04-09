/**
 * AddPasswordSheet — bottom sheet modal for adding or editing a password.
 *
 * iOS-style sheet that slides up from the bottom. It has:
 *   - A drag handle (visual only — no drag-to-dismiss for simplicity)
 *   - Three form fields: site name, username, password
 *   - Cancel and Save buttons
 *
 * The component is "controlled" — the parent (PasswordsPage) tells it
 * whether to be open, passes initial values (for editing), and handles
 * the save action.
 *
 * When `editEntry` is provided, we're in edit mode (title says "Edit Password",
 * fields are pre-filled). When null, we're in add mode.
 */

import { useState, useEffect } from 'react'
import type { DecryptedPassword } from './PasswordEntry'

interface AddPasswordSheetProps {
  open: boolean
  onClose: () => void
  onSave: (siteName: string, siteUrl: string, username: string, password: string) => void
  editEntry: DecryptedPassword | null  // null = add mode, non-null = edit mode
}

export default function AddPasswordSheet({ open, onClose, onSave, editEntry }: AddPasswordSheetProps) {
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // When the sheet opens, populate fields (empty for add, pre-filled for edit).
  // We use the `open` flag + `editEntry` as dependencies so the form resets
  // each time the sheet opens fresh.
  useEffect(() => {
    if (open) {
      setSiteName(editEntry?.siteName ?? '')
      setSiteUrl(editEntry?.siteUrl ?? '')
      setUsername(editEntry?.username ?? '')
      setPassword(editEntry?.password ?? '')
    }
  }, [open, editEntry])

  const handleSave = () => {
    // Basic validation — site name, username, password required. URL is optional.
    if (!siteName.trim() || !username.trim() || !password.trim()) return
    onSave(siteName.trim(), siteUrl.trim(), username.trim(), password.trim())
  }

  const isValid = siteName.trim() && username.trim() && password.trim()

  return (
    <>
      {/* Dark overlay behind the sheet — tap to close */}
      <div
        className={`sheet-overlay${open ? ' open' : ''}`}
        onClick={onClose}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
      />

      {/* The sheet itself */}
      <div className={`bottom-sheet${open ? ' open' : ''}`}>
        <div className="sheet-handle" />
        <div className="sheet-title">
          {editEntry ? 'Edit Password' : 'Add Password'}
        </div>

        <div className="form-group">
          <label className="form-label">Site Name</label>
          <input
            className="form-input"
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g. Netflix"
            autoFocus={open && !editEntry}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Site URL</label>
          <input
            className="form-input"
            type="url"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="e.g. https://netflix.com"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Username / Email</label>
          <input
            className="form-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. john@email.com"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
          />
        </div>

        <div className="form-actions">
          <button className="glass-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="glass-btn glass-btn-primary"
            onClick={handleSave}
            disabled={!isValid}
          >
            {editEntry ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
