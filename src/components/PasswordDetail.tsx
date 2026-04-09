/**
 * PasswordDetail — full-screen detail view for a password entry.
 *
 * Slides in from the right (like iOS UINavigationController push).
 * Shows:
 *   - Large avatar + site name
 *   - Username field with copy button
 *   - Password field with show/hide toggle + copy button
 *   - Edit and Delete action buttons in the header
 *
 * The password is hidden by default (replaced with dots). The user can
 * tap the eye icon to reveal it. Copy uses the Clipboard API.
 *
 * This component receives already-decrypted data — all crypto happens
 * in PasswordsPage before data reaches here.
 */

import { useState, useCallback } from 'react'
import type { DecryptedPassword } from './PasswordEntry'

interface PasswordDetailProps {
  entry: DecryptedPassword | null  // null = closed
  onClose: () => void
  onEdit: (entry: DecryptedPassword) => void
  onDelete: (id: number) => void
  onToast: (message: string) => void
}

/**
 * Same avatar gradient function as PasswordEntry — duplicated here
 * since it's small and only used in two places.
 */
function avatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue1 = Math.abs(hash) % 360
  const hue2 = (hue1 + 40) % 360
  return `linear-gradient(135deg, hsl(${hue1}, 65%, 50%), hsl(${hue2}, 55%, 40%))`
}

export default function PasswordDetail({ entry, onClose, onEdit, onDelete, onToast }: PasswordDetailProps) {
  const [showPassword, setShowPassword] = useState(false)

  // Reset password visibility when viewing a different entry.
  // We don't want the password to stay visible when navigating between entries.
  const [lastEntryId, setLastEntryId] = useState<number | null>(null)
  if (entry && entry.id !== lastEntryId) {
    setShowPassword(false)
    setLastEntryId(entry.id)
  }

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast(`${label} copied`)
    } catch {
      // Clipboard API can fail in some contexts (e.g., non-HTTPS).
      // Fall back to a less elegant but functional approach.
      onToast('Copy failed — try long-press')
    }
  }, [onToast])

  if (!entry) return null

  const firstLetter = entry.siteName.charAt(0).toUpperCase()

  return (
    <div className={`detail-overlay${entry ? ' open' : ''}`}>
      {/* Header: back button + edit/delete actions */}
      <div className="detail-header">
        <button className="detail-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
        <div className="detail-actions-row">
          <button className="detail-action-btn" onClick={() => onEdit(entry)}>
            Edit
          </button>
          <button className="detail-action-btn danger" onClick={() => onDelete(entry.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="detail-body">
        {/* Avatar + site name + URL */}
        <div className="detail-avatar-section">
          <div className="detail-avatar" style={{ background: avatarGradient(entry.siteName) }}>
            {firstLetter}
          </div>
          <div className="detail-site-name">{entry.siteName}</div>
          {entry.siteUrl && (
            <a
              className="detail-site-url"
              href={entry.siteUrl.startsWith('http') ? entry.siteUrl : `https://${entry.siteUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.siteUrl}
            </a>
          )}
        </div>

        {/* Username field */}
        <div className="detail-field">
          <div className="detail-field-label">Username</div>
          <div className="detail-field-row">
            <div className="detail-field-value">{entry.username}</div>
            <div className="detail-field-actions">
              <button
                className="field-icon-btn"
                onClick={() => copyToClipboard(entry.username, 'Username')}
                title="Copy username"
              >
                {/* Copy icon */}
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Password field — with show/hide toggle */}
        <div className="detail-field">
          <div className="detail-field-label">Password</div>
          <div className="detail-field-row">
            <div className={`detail-field-value${showPassword ? ' mono' : ''}`}>
              {showPassword ? entry.password : '••••••••••••'}
            </div>
            <div className="detail-field-actions">
              {/* Toggle visibility */}
              <button
                className="field-icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  // Eye-off icon
                  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  // Eye icon
                  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>

              {/* Copy password */}
              <button
                className="field-icon-btn"
                onClick={() => copyToClipboard(entry.password, 'Password')}
                title="Copy password"
              >
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
