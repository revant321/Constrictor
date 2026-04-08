/**
 * AddNoteSheet — bottom sheet modal for adding or editing a note.
 *
 * Similar structure to AddPasswordSheet but with:
 *   - Title text input
 *   - Content textarea (multiline)
 *   - Category picker: horizontal scroll of colored pills
 *
 * The category picker shows all existing categories as tinted pills.
 * The user taps one to assign the note to that category, or taps
 * "None" to leave it uncategorized. The selected pill gets a brighter
 * border to indicate selection.
 *
 * In edit mode, fields are pre-filled with the existing note's data.
 */

import { useState, useEffect } from 'react'
import type { DecryptedNote } from './NoteEntry'
import type { DecryptedCategory } from './CategoryChips'
import { COLOR_PALETTE } from '../pages/NotesPage'

interface AddNoteSheetProps {
  open: boolean
  onClose: () => void
  onSave: (title: string, content: string, categoryId: number | undefined) => void
  editNote: DecryptedNote | null
  categories: DecryptedCategory[]
}

export default function AddNoteSheet({ open, onClose, onSave, editNote, categories }: AddNoteSheetProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined)

  // Reset form when sheet opens (empty for add, pre-filled for edit).
  useEffect(() => {
    if (open) {
      setTitle(editNote?.title ?? '')
      setContent(editNote?.content ?? '')
      setCategoryId(editNote?.categoryId)
    }
  }, [open, editNote])

  const handleSave = () => {
    if (!title.trim()) return
    onSave(title.trim(), content.trim(), categoryId)
  }

  const isValid = title.trim().length > 0

  const sorted = [...categories].sort((a, b) => a.order - b.order)

  return (
    <>
      <div
        className={`sheet-overlay${open ? ' open' : ''}`}
        onClick={onClose}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
      />

      <div className={`bottom-sheet${open ? ' open' : ''}`}>
        <div className="sheet-handle" />
        <div className="sheet-title">
          {editNote ? 'Edit Note' : 'Add Note'}
        </div>

        {/* Title input */}
        <div className="form-group">
          <label className="form-label">Title</label>
          <input
            className="form-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            autoFocus={open && !editNote}
          />
        </div>

        {/* Content textarea */}
        <div className="form-group">
          <label className="form-label">Content</label>
          <textarea
            className="form-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your note..."
          />
        </div>

        {/* Category picker */}
        {sorted.length > 0 && (
          <div className="form-group">
            <label className="form-label">Category</label>
            <div className="category-picker-row">
              {/* "None" option */}
              <button
                className={`category-picker-pill ${categoryId === undefined ? 'selected' : 'unselected'}`}
                style={categoryId === undefined ? {
                  background: 'var(--glass-bg)',
                } : {
                  background: 'var(--glass-bg-subtle)',
                }}
                onClick={() => setCategoryId(undefined)}
              >
                None
              </button>

              {sorted.map((cat) => {
                const isSelected = categoryId === cat.id
                const rgba = COLOR_PALETTE[cat.color]

                return (
                  <button
                    key={cat.id}
                    className={`category-picker-pill ${isSelected ? 'selected' : 'unselected'}`}
                    style={isSelected ? {
                      background: rgba.replace('0.15)', '0.25)'),
                      color: 'var(--text-primary)',
                    } : {
                      background: rgba,
                    }}
                    onClick={() => setCategoryId(cat.id)}
                  >
                    {cat.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="form-actions">
          <button className="glass-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="glass-btn glass-btn-primary"
            onClick={handleSave}
            disabled={!isValid}
          >
            {editNote ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
