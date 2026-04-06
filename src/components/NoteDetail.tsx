/**
 * NoteDetail — full-screen detail view for a note.
 *
 * Slides in from the right (same as PasswordDetail). Shows:
 *   - Title (large heading)
 *   - Category badge with tinted background
 *   - Full note content (pre-wrapped)
 *   - Date last modified
 *   - Edit and Delete action buttons in the header
 *
 * Unlike PasswordDetail, there's no show/hide toggle — note content
 * is always visible since it's not a secret like a password.
 */

import type { DecryptedNote } from './NoteEntry'
import type { DecryptedCategory } from './CategoryChips'
import { COLOR_PALETTE } from '../pages/NotesPage'

interface NoteDetailProps {
  note: DecryptedNote | null
  category?: DecryptedCategory
  onClose: () => void
  onEdit: (note: DecryptedNote) => void
  onDelete: (id: number) => void
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function NoteDetail({ note, category, onClose, onEdit, onDelete }: NoteDetailProps) {
  if (!note) return null

  const badgeBg = category
    ? COLOR_PALETTE[category.color]
    : undefined

  return (
    <div className={`detail-overlay${note ? ' open' : ''}`}>
      {/* Header: back + edit/delete */}
      <div className="detail-header">
        <button className="detail-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
        <div className="detail-actions-row">
          <button className="detail-action-btn" onClick={() => onEdit(note)}>
            Edit
          </button>
          <button className="detail-action-btn danger" onClick={() => onDelete(note.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="note-detail-content">
        <h1 className="note-detail-title">{note.title}</h1>

        {category && (
          <div
            className="note-detail-category-badge"
            style={{ background: badgeBg }}
          >
            {category.name}
          </div>
        )}

        <div className="note-detail-text">
          {note.content || 'No content'}
        </div>

        <div className="note-detail-date">
          Last edited {formatFullDate(note.dateModified)}
        </div>
      </div>
    </div>
  )
}
