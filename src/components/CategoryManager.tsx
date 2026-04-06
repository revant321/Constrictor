/**
 * CategoryManager — full-screen overlay for managing note categories.
 *
 * Opened from the "Manage" chip in CategoryChips. Provides CRUD for
 * categories: create new, rename existing, change color, delete.
 *
 * Layout:
 *   - List of existing categories with color swatch, name, edit/delete buttons
 *   - "Add Category" form at the bottom with name input + color picker grid
 *
 * The color picker shows the 8 predefined colors from the spec as
 * tappable swatches. The selected swatch gets a white border and a
 * checkmark icon.
 *
 * When renaming, the same form section switches to "Rename Category"
 * mode with the existing name pre-filled and color pre-selected.
 *
 * Deleting a category removes it from the DB and sets all notes in
 * that category to uncategorized (handled by NotesPage).
 */

import { useState, useEffect } from 'react'
import type { DecryptedCategory } from './CategoryChips'
import { COLOR_PALETTE, type CategoryColor } from '../pages/NotesPage'

interface CategoryManagerProps {
  open: boolean
  onClose: () => void
  categories: DecryptedCategory[]
  onAdd: (name: string, color: CategoryColor) => void
  onRename: (id: number, newName: string) => void
  onDelete: (id: number) => void
  onChangeColor: (id: number, color: CategoryColor) => void
}

const ALL_COLORS: CategoryColor[] = [
  'blue', 'purple', 'rose', 'amber', 'emerald', 'cyan', 'orange', 'pink',
]

export default function CategoryManager({
  open,
  onClose,
  categories,
  onAdd,
  onRename,
  onDelete,
  onChangeColor,
}: CategoryManagerProps) {
  // Form state for add/rename
  const [name, setName] = useState('')
  const [color, setColor] = useState<CategoryColor>('blue')
  // If editingId is set, we're in rename mode for that category
  const [editingId, setEditingId] = useState<number | null>(null)
  // Confirm delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // Reset form when overlay opens/closes
  useEffect(() => {
    if (open) {
      setName('')
      setColor('blue')
      setEditingId(null)
      setConfirmDeleteId(null)
    }
  }, [open])

  const handleSave = () => {
    if (!name.trim()) return

    if (editingId !== null) {
      onRename(editingId, name.trim())
      // Also update color if changed
      const cat = categories.find((c) => c.id === editingId)
      if (cat && cat.color !== color) {
        onChangeColor(editingId, color)
      }
      setEditingId(null)
    } else {
      onAdd(name.trim(), color)
    }

    setName('')
    setColor('blue')
  }

  const handleEditClick = (cat: DecryptedCategory) => {
    setEditingId(cat.id)
    setName(cat.name)
    setColor(cat.color)
    setConfirmDeleteId(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setName('')
    setColor('blue')
  }

  const handleDeleteClick = (id: number) => {
    setConfirmDeleteId(id)
  }

  const handleConfirmDelete = () => {
    if (confirmDeleteId !== null) {
      onDelete(confirmDeleteId)
      setConfirmDeleteId(null)
      if (editingId === confirmDeleteId) {
        setEditingId(null)
        setName('')
        setColor('blue')
      }
    }
  }

  const sorted = [...categories].sort((a, b) => a.order - b.order)

  return (
    <div className={`detail-overlay${open ? ' open' : ''}`}>
      {/* Header */}
      <div className="detail-header">
        <button className="detail-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
      </div>

      <div className="detail-body">
        <div className="page-header" style={{ paddingLeft: 0 }}>
          <h1 className="page-title">Categories</h1>
        </div>

        {/* Existing categories list */}
        {sorted.length === 0 ? (
          <p style={{
            color: 'rgba(255, 255, 255, 0.35)',
            fontSize: '15px',
            padding: '20px 0',
          }}>
            No categories yet. Create one below.
          </p>
        ) : (
          <ul className="category-manager-list">
            {sorted.map((cat) => (
              <li key={cat.id} className="category-manager-item">
                {/* Color swatch */}
                <div
                  className="category-manager-color"
                  style={{ background: COLOR_PALETTE[cat.color].replace('0.15)', '0.4)') }}
                />

                {/* Category name */}
                <span className="category-manager-name">{cat.name}</span>

                {/* Edit + Delete buttons */}
                <div className="category-manager-actions">
                  <button
                    className="category-manager-btn"
                    onClick={() => handleEditClick(cat)}
                    title="Rename"
                  >
                    {/* Pencil icon */}
                    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="category-manager-btn danger"
                    onClick={() => handleDeleteClick(cat.id)}
                    title="Delete"
                  >
                    {/* Trash icon */}
                    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Delete confirmation inline */}
        {confirmDeleteId !== null && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginTop: '12px',
          }}>
            <p style={{ color: '#f3f4f6', fontSize: '14px', marginBottom: '12px' }}>
              Delete this category? Notes in it will become uncategorized.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="glass-btn" style={{ flex: 1, padding: '10px' }} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                className="glass-btn"
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                }}
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Add / Rename form section */}
        <div className="category-form-section">
          <h3>{editingId !== null ? 'Rename Category' : 'Add Category'}</h3>

          {/* Name input */}
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal, School, Work"
            />
          </div>

          {/* Color picker grid */}
          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="color-picker-grid">
              {ALL_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${color === c ? ' selected' : ''}`}
                  style={{ background: COLOR_PALETTE[c].replace('0.15)', '0.4)') }}
                  onClick={() => setColor(c)}
                >
                  {color === c && (
                    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Save / Cancel buttons */}
          <div className="category-form-row">
            {editingId !== null && (
              <button className="glass-btn" onClick={handleCancelEdit} style={{ flex: 1 }}>
                Cancel
              </button>
            )}
            <button
              className="glass-btn glass-btn-primary"
              onClick={handleSave}
              disabled={!name.trim()}
              style={{ flex: 1 }}
            >
              {editingId !== null ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
