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
 * Generates a consistent gradient from a string.
 * Same site name always gets the same gradient — we hash the string to two
 * hues 40deg apart, creating a diagonal gradient. Gradients add more depth
 * and visual interest than flat solid colors.
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

const SWIPE_THRESHOLD = 80

export default function PasswordEntry({ entry, onTap, onDelete }: PasswordEntryProps) {
  const [offset, setOffset] = useState(0)
  const [swiped, setSwiped] = useState(false)
  const [animating, setAnimating] = useState(false)
  const startXRef = useRef(0)
  const startOffsetRef = useRef(0)
  const movingRef = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX
    startOffsetRef.current = swiped ? -SWIPE_THRESHOLD : 0
    movingRef.current = false
    // Remove transition so dragging feels immediate
    setAnimating(false)
  }, [swiped])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - startXRef.current
    if (Math.abs(deltaX) > 5) movingRef.current = true
    const newOffset = Math.max(-SWIPE_THRESHOLD, Math.min(0, startOffsetRef.current + deltaX))
    setOffset(newOffset)
  }, [])

  const handleTouchEnd = useCallback(() => {
    // Enable transition for snap animation
    setAnimating(true)
    if (offset < -SWIPE_THRESHOLD / 2) {
      setOffset(-SWIPE_THRESHOLD)
      setSwiped(true)
    } else {
      setOffset(0)
      setSwiped(false)
    }
  }, [offset])

  /**
   * Handle tap on the inner (visible) area.
   * Three cases:
   *   1. User was swiping (movingRef true) → do nothing, the swipe gesture
   *      already handled everything in touchEnd.
   *   2. Delete button is showing (swiped true) → close the swipe, don't
   *      open detail view.
   *   3. Normal tap → open detail view.
   */
  const handleInnerClick = useCallback(() => {
    if (movingRef.current) return
    if (swiped) {
      setAnimating(true)
      setOffset(0)
      setSwiped(false)
      return
    }
    onTap(entry)
  }, [swiped, entry, onTap])

  /**
   * Handle tap on the red delete button.
   * This is a completely separate click handler on a separate element —
   * it never conflicts with handleInnerClick because the inner element
   * has translated away, leaving the delete button exposed.
   */
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(entry.id)
  }, [entry.id, onDelete])

  const firstLetter = entry.siteName.charAt(0).toUpperCase()
  const bgGradient = avatarGradient(entry.siteName)

  return (
    <li className="password-item">
      {/* Red delete button behind the content */}
      <div className="swipe-bg" onClick={handleDeleteClick}>
        Delete
      </div>

      {/* Visible content — slides left on swipe to reveal delete button */}
      <div
        className="password-item-inner"
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? 'transform 0.2s ease' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleInnerClick}
      >
        <div className="password-avatar" style={{ background: bgGradient }}>
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
        <button
          className="password-hover-delete"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(entry.id)
          }}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
