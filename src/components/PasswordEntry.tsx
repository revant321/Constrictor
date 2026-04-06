/**
 * PasswordEntry — a single row in the password list.
 *
 * Features:
 *   - First-letter avatar with a deterministic color based on site name
 *   - Site name + username (both decrypted before being passed in)
 *   - Swipe-left to reveal a delete button (iOS Mail-style)
 *   - Tap to open detail view
 *
 * Swipe implementation:
 *   The component has two layers: a red delete button (.swipe-bg) that sits
 *   behind the visible content (.password-item-inner). On touchmove, we
 *   translate the inner layer left to reveal the delete button. If the user
 *   swipes past a threshold (80px), we snap to "open" state showing the
 *   delete button. Tapping delete triggers onDelete.
 *
 *   We track the swipe with three values:
 *   - startX: where the touch started
 *   - currentOffset: how far the inner layer is currently translated
 *   - swiped: whether the delete button is currently revealed
 */

import { useRef, useState, useCallback } from 'react'

/**
 * DecryptedPassword is the shape of a password entry after decryption.
 * The PasswordsPage decrypts all fields before passing them to this component,
 * so we're working with plaintext strings here — not ciphertext.
 */
export interface DecryptedPassword {
  id: number
  siteName: string
  username: string
  password: string
  dateAdded: number
  dateModified: number
}

interface PasswordEntryProps {
  entry: DecryptedPassword
  onTap: (entry: DecryptedPassword) => void
  onDelete: (id: number) => void
}

/**
 * Generates a consistent HSL color from a string.
 * Same site name always gets the same color — we hash the string to a hue.
 * The saturation and lightness are fixed for a pleasant, muted palette
 * that works on dark backgrounds.
 */
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 45%)`
}

const SWIPE_THRESHOLD = 80

export default function PasswordEntry({ entry, onTap, onDelete }: PasswordEntryProps) {
  const [offset, setOffset] = useState(0)
  const [swiped, setSwiped] = useState(false)
  const startXRef = useRef(0)
  const startOffsetRef = useRef(0)
  const movingRef = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX
    startOffsetRef.current = swiped ? -SWIPE_THRESHOLD : 0
    movingRef.current = false
  }, [swiped])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - startXRef.current
    // Only count as a move if we've swiped at least 5px — prevents
    // accidental swipes when the user meant to tap.
    if (Math.abs(deltaX) > 5) movingRef.current = true

    // Calculate new offset. Clamp between -SWIPE_THRESHOLD and 0
    // (can't swipe right past origin, can't swipe left past the delete button).
    const newOffset = Math.max(-SWIPE_THRESHOLD, Math.min(0, startOffsetRef.current + deltaX))
    setOffset(newOffset)
  }, [])

  const handleTouchEnd = useCallback(() => {
    // If swiped past half the threshold, snap open. Otherwise snap closed.
    if (offset < -SWIPE_THRESHOLD / 2) {
      setOffset(-SWIPE_THRESHOLD)
      setSwiped(true)
    } else {
      setOffset(0)
      setSwiped(false)
    }
  }, [offset])

  const handleTap = useCallback(() => {
    // If we were swiping (not tapping), don't open the detail view.
    if (movingRef.current) return
    // If the delete button is showing, close it on tap instead of opening detail.
    if (swiped) {
      setOffset(0)
      setSwiped(false)
      return
    }
    onTap(entry)
  }, [swiped, entry, onTap])

  const handleDelete = useCallback(() => {
    onDelete(entry.id)
  }, [entry.id, onDelete])

  const firstLetter = entry.siteName.charAt(0).toUpperCase()
  const bgColor = avatarColor(entry.siteName)

  return (
    <li className="password-item">
      {/* Red delete button behind the content */}
      <div className="swipe-bg" onClick={handleDelete}>
        Delete
      </div>

      {/* Visible content — slides left on swipe */}
      <div
        className="password-item-inner"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleTap}
      >
        <div className="password-avatar" style={{ background: bgColor }}>
          {firstLetter}
        </div>
        <div className="password-item-text">
          <div className="password-item-site">{entry.siteName}</div>
          <div className="password-item-username">{entry.username}</div>
        </div>
        <div className="password-item-chevron">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </li>
  )
}
