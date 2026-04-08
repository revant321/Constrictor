/**
 * NoteEntry — a single card in the notes list.
 *
 * Each card shows:
 *   - Title (bold, one line, truncated)
 *   - Content preview (one line, truncated)
 *   - Date last modified
 *   - Category name badge (if categorized)
 *   - Colored left border matching the category color
 *
 * The category color tint uses COLOR_SOLID (0.6 alpha) for the left
 * border so it's visible against the dark background. The category
 * badge uses COLOR_PALETTE (0.15 alpha) for a subtle tinted pill.
 *
 * No swipe-to-delete here (unlike passwords) — notes use a detail
 * view with edit/delete buttons instead, since notes are more
 * content-heavy and accidental deletion would be worse.
 */

import type { DecryptedCategory } from './CategoryChips'
import { COLOR_SOLID, COLOR_PALETTE, type CategoryColor } from '../pages/NotesPage'

export interface DecryptedNote {
  id: number
  categoryId?: number
  title: string
  content: string
  order?: number          // Phase 8: display order for manual sort mode
  dateAdded: number
  dateModified: number
}

interface NoteEntryProps {
  note: DecryptedNote
  category?: DecryptedCategory
  onTap: (note: DecryptedNote) => void
  isDragging?: boolean      // This note is currently being dragged
  isInsertTarget?: boolean  // Show insertion indicator above this note (reorder)
  onTouchStart?: (e: React.TouchEvent) => void  // Phase 8: long-press drag initiation
  onMouseDown?: (e: React.MouseEvent) => void   // Phase 8: mouse long-press drag initiation
}

/**
 * Formats a timestamp into a short readable date.
 * Uses the user's locale for natural formatting.
 * Shows "Today" or "Yesterday" for recent dates, otherwise "Apr 6, 2026".
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)

  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

export default function NoteEntry({ note, category, onTap, isDragging, isInsertTarget, onTouchStart, onMouseDown }: NoteEntryProps) {
  // Left border color: category color if categorized, transparent if not.
  const borderColor = category
    ? COLOR_SOLID[category.color]
    : 'var(--separator)'

  // Category badge background
  const badgeBg = category
    ? COLOR_PALETTE[category.color as CategoryColor]
    : undefined

  // Build className based on drag state
  const classes = [
    'note-item',
    isDragging && 'note-item-dragging',
    isInsertTarget && 'note-item-insert-target',
  ].filter(Boolean).join(' ')

  return (
    <li
      className={classes}
      data-note-id={note.id}
      style={{ borderLeftColor: borderColor }}
      onClick={() => !isDragging && onTap(note)}
      onTouchStart={onTouchStart}
      onMouseDown={onMouseDown}
    >
      <div className="note-item-title">{note.title}</div>
      <div className="note-item-preview">{note.content}</div>
      <div className="note-item-meta">
        <span className="note-item-date">{formatDate(note.dateModified)}</span>
        {category && (
          <span
            className="note-item-category"
            style={{ background: badgeBg }}
          >
            {category.name}
          </span>
        )}
      </div>
    </li>
  )
}
