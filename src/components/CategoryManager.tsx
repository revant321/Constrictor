/**
 * CategoryManager — full-screen overlay for managing note categories.
 *
 * Phase 8 additions:
 *   - In Manual sort mode, categories can be reordered via drag-and-drop.
 *     Each category row gets a grip-dots drag handle on the left.
 *     Long-pressing the handle initiates drag. The dragged row follows
 *     the finger vertically, and a blue insertion line shows where it
 *     will land.
 *   - The `sortMode` prop controls whether reorder handles are visible.
 *   - The `onReorder` callback receives the new order of category IDs.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { DecryptedCategory } from './CategoryChips'
import { COLOR_PALETTE, type CategoryColor } from '../pages/NotesPage'
import type { NoteSortMode } from '../services/auth'

interface CategoryManagerProps {
  open: boolean
  onClose: () => void
  categories: DecryptedCategory[]
  onAdd: (name: string, color: CategoryColor) => void
  onRename: (id: number, newName: string) => void
  onDelete: (id: number) => void
  onChangeColor: (id: number, color: CategoryColor) => void
  sortMode?: NoteSortMode
  onReorder?: (orderedIds: number[]) => void
}

const ALL_COLORS: CategoryColor[] = [
  'blue', 'purple', 'rose', 'amber', 'emerald', 'cyan', 'orange', 'pink',
]

// ─── Drag handle icon (6 dots in 2 columns) ────────────────────
// This is the universal "drag to reorder" icon — two columns of
// three dots, like the grip dots in iOS reorder controls.
const GripIcon = () => (
  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export default function CategoryManager({
  open,
  onClose,
  categories,
  onAdd,
  onRename,
  onDelete,
  onChangeColor,
  sortMode = 'date',
  onReorder,
}: CategoryManagerProps) {
  // Form state for add/rename
  const [name, setName] = useState('')
  const [color, setColor] = useState<CategoryColor>('blue')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // ── Category drag-to-reorder state ──────────────────────────────
  const [dragCatId, setDragCatId] = useState<number | null>(null)
  const [insertBeforeCatId, setInsertBeforeCatId] = useState<number | null>(null)
  const [ghostY, setGhostY] = useState(0)
  const isDraggingRef = useRef(false)
  const longPressRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ y: number; catId: number } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setColor('blue')
      setEditingId(null)
      setConfirmDeleteId(null)
      setDragCatId(null)
    }
  }, [open])

  // ── Shared move logic for category reorder ─────────────────────
  const handleCatPointerMove = useCallback((clientX: number, clientY: number, preventDefault: () => void) => {
    if (!isDraggingRef.current && touchStartRef.current) {
      const dy = Math.abs(clientY - touchStartRef.current.y)
      if (dy > 10) {
        if (longPressRef.current) {
          clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }
      return
    }

    if (!isDraggingRef.current) return
    preventDefault()

    setGhostY(clientY)

    const el = document.elementFromPoint(clientX, clientY)
    if (el) {
      const itemEl = el.closest('[data-cat-id]') as HTMLElement | null
      if (itemEl) {
        const hoveredId = Number(itemEl.getAttribute('data-cat-id'))
        if (hoveredId !== touchStartRef.current?.catId) {
          setInsertBeforeCatId(hoveredId)
        } else {
          setInsertBeforeCatId(null)
        }
      }
    }
  }, [])

  // ── Attach non-passive touchmove + mousemove for category reorder
  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      handleCatPointerMove(touch.clientX, touch.clientY, () => e.preventDefault())
    }

    const handleMouseMove = (e: MouseEvent) => {
      handleCatPointerMove(e.clientX, e.clientY, () => e.preventDefault())
    }

    list.addEventListener('touchmove', handleTouchMove, { passive: false })
    list.addEventListener('mousemove', handleMouseMove)
    return () => {
      list.removeEventListener('touchmove', handleTouchMove)
      list.removeEventListener('mousemove', handleMouseMove)
    }
  }, [open, handleCatPointerMove])

  const startCatLongPress = useCallback((catId: number, clientY: number) => {
    touchStartRef.current = { y: clientY, catId }

    longPressRef.current = window.setTimeout(() => {
      isDraggingRef.current = true
      setDragCatId(catId)
      setGhostY(clientY)
      if (navigator.vibrate) navigator.vibrate(50)
    }, 300)
  }, [])

  const handleCatTouchStart = useCallback((catId: number, e: React.TouchEvent) => {
    startCatLongPress(catId, e.touches[0].clientY)
  }, [startCatLongPress])

  const handleCatMouseDown = useCallback((catId: number, e: React.MouseEvent) => {
    if (e.button !== 0) return
    startCatLongPress(catId, e.clientY)
  }, [startCatLongPress])

  const handleCatTouchEnd = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }

    if (isDraggingRef.current && dragCatId !== null && insertBeforeCatId !== null && onReorder) {
      // Compute new order
      const currentOrder = sorted.map(c => c.id)
      const dragIdx = currentOrder.indexOf(dragCatId)
      const targetIdx = currentOrder.indexOf(insertBeforeCatId)

      if (dragIdx !== -1 && targetIdx !== -1 && dragIdx !== targetIdx) {
        currentOrder.splice(dragIdx, 1)
        const insertIdx = dragIdx < targetIdx ? targetIdx - 1 : targetIdx
        currentOrder.splice(insertIdx, 0, dragCatId)
        onReorder(currentOrder)
      }
    }

    isDraggingRef.current = false
    touchStartRef.current = null
    setDragCatId(null)
    setInsertBeforeCatId(null)
  }, [dragCatId, insertBeforeCatId, onReorder]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    if (!name.trim()) return

    if (editingId !== null) {
      onRename(editingId, name.trim())
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

  // Sort categories based on sort mode (same logic as CategoryChips)
  const sorted = [...categories].sort((a, b) =>
    sortMode === 'manual' ? a.order - b.order : a.dateAdded - b.dateAdded
  )

  const isManual = sortMode === 'manual'

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

      <div className="detail-body" onTouchEnd={handleCatTouchEnd} onTouchCancel={handleCatTouchEnd} onMouseUp={handleCatTouchEnd} onMouseLeave={handleCatTouchEnd}>
        <div className="page-header" style={{ paddingLeft: 0 }}>
          <h1 className="page-title">Categories</h1>
          {isManual && (
            <span className="sort-mode-badge">Drag to reorder</span>
          )}
        </div>

        {/* Existing categories list */}
        {sorted.length === 0 ? (
          <p style={{
            color: 'var(--text-dim)',
            fontSize: '15px',
            padding: '20px 0',
          }}>
            No categories yet. Create one below.
          </p>
        ) : (
          <ul className="category-manager-list" ref={listRef}>
            {sorted.map((cat) => (
              <li
                key={cat.id}
                data-cat-id={cat.id}
                className={[
                  'category-manager-item',
                  dragCatId === cat.id && 'category-manager-item-dragging',
                  insertBeforeCatId === cat.id && 'category-manager-item-insert',
                ].filter(Boolean).join(' ')}
              >
                {/* Drag handle — only in Manual mode */}
                {isManual && (
                  <div
                    className="drag-handle"
                    onTouchStart={(e) => handleCatTouchStart(cat.id, e)}
                    onMouseDown={(e) => handleCatMouseDown(cat.id, e)}
                  >
                    <GripIcon />
                  </div>
                )}

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

        {/* Drag ghost for category reorder */}
        {dragCatId !== null && (() => {
          const cat = categories.find(c => c.id === dragCatId)
          return cat ? (
            <>
              <div className="drag-overlay" />
              <div
                className="drag-ghost"
                style={{ left: 40, top: ghostY - 20 }}
              >
                {cat.name}
              </div>
            </>
          ) : null
        })()}

        {/* Delete confirmation inline */}
        {confirmDeleteId !== null && (
          <div style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginTop: '12px',
          }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '14px', marginBottom: '12px' }}>
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
                  background: 'var(--error-bg)',
                  borderColor: 'var(--error-border)',
                  color: 'var(--error-color)',
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
