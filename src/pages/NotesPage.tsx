/**
 * NotesPage — the Notes tab with Phase 8 drag-and-drop support.
 *
 * Phase 8 adds three major interactions:
 *   1. Drag note → category chip to reassign its category
 *   2. Manual sort mode with drag-to-reorder notes
 *   3. Category ordering follows the active sort mode
 *
 * DRAG-AND-DROP ARCHITECTURE:
 *
 * We use raw touch events (touchstart/touchmove/touchend) because this
 * is a mobile-first PWA. The drag system works in three phases:
 *
 *   PHASE A — Long-press detection:
 *     On touchstart, we start a 300ms timer. If the finger moves more
 *     than 10px before the timer fires, we cancel (it's a scroll).
 *     If the timer fires, we enter drag mode and vibrate (haptic).
 *
 *   PHASE B — Dragging:
 *     A "ghost" element (fixed-position mini card) follows the finger.
 *     We call document.elementFromPoint() on each touchmove to detect:
 *       - Category chips (data-category-id attribute) → drop target
 *       - Note items (data-note-id attribute) → reorder position
 *     The touchmove handler MUST call preventDefault() to stop page
 *     scrolling during drag. React's touch events are passive by default,
 *     so we attach the listener via a ref with { passive: false }.
 *
 *   PHASE C — Drop:
 *     On touchend, we check the drag state:
 *       - If over a category chip → reassign note's categoryId
 *       - If in manual mode with a new position → reorder
 *       - Otherwise → cancel (no change)
 *
 * WHY NOT A DRAG LIBRARY?
 *   Libraries like react-dnd or dnd-kit add significant bundle size and
 *   complexity. Our drag interactions are specific enough that raw touch
 *   events are cleaner. We only need: long-press, ghost, elementFromPoint,
 *   and simple state updates. No nested drop contexts or complex accessibility
 *   trees needed for this use case.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../services/db'
import { encrypt, decrypt } from '../services/crypto'
import { getKey } from '../services/auth'
import { getNoteSortMode, type NoteSortMode } from '../services/auth'
import CategoryChips, { type DecryptedCategory } from '../components/CategoryChips'
import NoteEntry, { type DecryptedNote } from '../components/NoteEntry'
import AddNoteSheet from '../components/AddNoteSheet'
import NoteDetail from '../components/NoteDetail'
import CategoryManager from '../components/CategoryManager'

// ─── Color Palette ──────────────────────────────────────────────
export type CategoryColor = 'blue' | 'purple' | 'rose' | 'amber' | 'emerald' | 'cyan' | 'orange' | 'pink'

export const COLOR_PALETTE: Record<CategoryColor, string> = {
  blue:    'rgba(59, 130, 246, 0.15)',
  purple:  'rgba(168, 85, 247, 0.15)',
  rose:    'rgba(244, 63, 94, 0.15)',
  amber:   'rgba(245, 158, 11, 0.15)',
  emerald: 'rgba(16, 185, 129, 0.15)',
  cyan:    'rgba(6, 182, 212, 0.15)',
  orange:  'rgba(249, 115, 22, 0.15)',
  pink:    'rgba(236, 72, 153, 0.15)',
}

export const COLOR_SOLID: Record<CategoryColor, string> = {
  blue:    'rgba(59, 130, 246, 0.6)',
  purple:  'rgba(168, 85, 247, 0.6)',
  rose:    'rgba(244, 63, 94, 0.6)',
  amber:   'rgba(245, 158, 11, 0.6)',
  emerald: 'rgba(16, 185, 129, 0.6)',
  cyan:    'rgba(6, 182, 212, 0.6)',
  orange:  'rgba(249, 115, 22, 0.6)',
  pink:    'rgba(236, 72, 153, 0.6)',
}

// ─── Drag state type ────────────────────────────────────────────
interface DragState {
  noteId: number
  noteTitle: string              // Shown in the ghost element
  ghostX: number                 // Current finger X
  ghostY: number                 // Current finger Y
  dropTargetCategoryId: number | 'all' | null  // Which chip the finger is over
  insertBeforeNoteId: number | null            // For reorder: insert before this note
}

export default function NotesPage() {
  // ── Core state ────────────────────────────────────────────────────
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [categories, setCategories] = useState<DecryptedCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editNote, setEditNote] = useState<DecryptedNote | null>(null)
  const [detailNote, setDetailNote] = useState<DecryptedNote | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Phase 8 state ─────────────────────────────────────────────────
  const [sortMode, setSortMode] = useState<NoteSortMode>('date')
  const [dragState, setDragState] = useState<DragState | null>(null)

  // ── Refs for drag system ──────────────────────────────────────────
  // We use refs instead of state for values that change rapidly during
  // touchmove (60fps). Reading state in event handlers would give stale
  // closures; refs always give the current value.
  const longPressTimerRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number; noteId: number; title: string } | null>(null)
  const isDraggingRef = useRef(false)
  const dragStateRef = useRef<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep dragStateRef in sync with dragState
  useEffect(() => { dragStateRef.current = dragState }, [dragState])

  // ── Load sort mode on mount ───────────────────────────────────────
  useEffect(() => {
    getNoteSortMode().then(setSortMode)
  }, [])

  // ── Load & Decrypt ────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    const key = getKey()
    if (!key) return []

    const rows = await db.noteCategories.toArray()
    const decrypted: DecryptedCategory[] = await Promise.all(
      rows.map(async (row) => ({
        id: row.id!,
        name: await decrypt(row.name, key),
        color: row.color as CategoryColor,
        order: row.order,
        dateAdded: row.dateAdded,
      }))
    )
    return decrypted
  }, [])

  const loadNotes = useCallback(async () => {
    const key = getKey()
    if (!key) return []

    const rows = await db.notes.toArray()
    const decrypted: DecryptedNote[] = await Promise.all(
      rows.map(async (row) => {
        const [title, content] = await Promise.all([
          decrypt(row.title, key),
          decrypt(row.content, key),
        ])
        return {
          id: row.id!,
          categoryId: row.categoryId,
          title,
          content,
          order: row.order,
          dateAdded: row.dateAdded,
          dateModified: row.dateModified,
        }
      })
    )
    return decrypted
  }, [])

  // Sort notes based on current sort mode
  const sortNotes = useCallback((noteList: DecryptedNote[], mode: NoteSortMode) => {
    if (mode === 'manual') {
      // Manual mode: sort by order field. Notes without an order value
      // go to the end (this handles notes created before manual mode
      // was ever activated).
      return [...noteList].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    }
    // Date mode: newest first (default behavior from before Phase 8)
    return [...noteList].sort((a, b) => b.dateModified - a.dateModified)
  }, [])

  const loadAll = useCallback(async () => {
    const [cats, nts, mode] = await Promise.all([
      loadCategories(),
      loadNotes(),
      getNoteSortMode(),
    ])
    setCategories(cats)
    setSortMode(mode)
    setNotes(sortNotes(nts, mode))
    setLoading(false)
  }, [loadCategories, loadNotes, sortNotes])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Add / Edit Note ───────────────────────────────────────────────
  const handleSaveNote = useCallback(async (
    title: string,
    content: string,
    categoryId: number | undefined,
  ) => {
    const key = getKey()
    if (!key) return

    const [encTitle, encContent] = await Promise.all([
      encrypt(title, key),
      encrypt(content, key),
    ])

    const now = Date.now()

    if (editNote) {
      await db.notes.update(editNote.id, {
        title: encTitle,
        content: encContent,
        categoryId,
        dateModified: now,
      })
    } else {
      // New notes get the highest order + 1 so they appear at the end
      // in manual mode, or are sorted by date in date mode.
      const maxOrder = notes.reduce((max, n) => Math.max(max, n.order ?? 0), 0)
      await db.notes.add({
        title: encTitle,
        content: encContent,
        categoryId,
        order: maxOrder + 1,
        dateAdded: now,
        dateModified: now,
      })
    }

    setSheetOpen(false)
    setEditNote(null)
    await loadAll()
    showToast(editNote ? 'Note updated' : 'Note added')
  }, [editNote, loadAll, notes])

  // ── Delete Note ───────────────────────────────────────────────────
  const handleDeleteNote = useCallback(async (id: number) => {
    await db.notes.delete(id)
    if (detailNote?.id === id) setDetailNote(null)
    setConfirmDeleteId(null)
    await loadAll()
    showToast('Note deleted')
  }, [detailNote, loadAll])

  // ── Category CRUD ─────────────────────────────────────────────────
  const handleAddCategory = useCallback(async (name: string, color: CategoryColor) => {
    const key = getKey()
    if (!key) return

    const encName = await encrypt(name, key)
    const maxOrder = categories.reduce((max, c) => Math.max(max, c.order), 0)

    await db.noteCategories.add({
      name: encName,
      color,
      order: maxOrder + 1,
      dateAdded: Date.now(),
    })

    await loadAll()
    showToast('Category added')
  }, [categories, loadAll])

  const handleRenameCategory = useCallback(async (id: number, newName: string) => {
    const key = getKey()
    if (!key) return
    const encName = await encrypt(newName, key)
    await db.noteCategories.update(id, { name: encName })
    await loadAll()
    showToast('Category renamed')
  }, [loadAll])

  const handleDeleteCategory = useCallback(async (id: number) => {
    const notesInCategory = await db.notes.where('categoryId').equals(id).toArray()
    await Promise.all(
      notesInCategory.map((n) => db.notes.update(n.id!, { categoryId: undefined }))
    )
    await db.noteCategories.delete(id)
    if (selectedCategoryId === id) setSelectedCategoryId(null)
    await loadAll()
    showToast('Category deleted')
  }, [selectedCategoryId, loadAll])

  const handleChangeCategoryColor = useCallback(async (id: number, color: CategoryColor) => {
    await db.noteCategories.update(id, { color })
    await loadAll()
  }, [loadAll])

  // ── Category reorder (Phase 8) ────────────────────────────────────
  // Called from CategoryManager when user drags categories in manual mode.
  const handleReorderCategories = useCallback(async (orderedIds: number[]) => {
    await Promise.all(
      orderedIds.map((id, index) =>
        db.noteCategories.update(id, { order: index })
      )
    )
    await loadAll()
  }, [loadAll])

  // ── Toast ─────────────────────────────────────────────────────────
  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 2000)
  }

  const handleEditFromDetail = useCallback((note: DecryptedNote) => {
    setDetailNote(null)
    setEditNote(note)
    setTimeout(() => setSheetOpen(true), 100)
  }, [])

  const handleRequestDelete = useCallback((id: number) => {
    setConfirmDeleteId(id)
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // DRAG AND DROP — Touch event handlers
  //
  // The drag system uses three touch events on a container div:
  //   - touchstart on individual note items → starts long-press timer
  //   - touchmove on the container → updates ghost position, detects targets
  //   - touchend on the container → executes drop or cancels
  //
  // We attach touchmove with { passive: false } via useEffect so we
  // can call preventDefault() to block scrolling during drag.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Shared logic for starting long-press detection from either touch or mouse.
   */
  const startLongPress = useCallback((noteId: number, title: string, clientX: number, clientY: number) => {
    touchStartRef.current = { x: clientX, y: clientY, noteId, title }

    longPressTimerRef.current = window.setTimeout(() => {
      isDraggingRef.current = true

      const newState: DragState = {
        noteId,
        noteTitle: title,
        ghostX: clientX,
        ghostY: clientY,
        dropTargetCategoryId: null,
        insertBeforeNoteId: null,
      }
      setDragState(newState)
      dragStateRef.current = newState

      if (navigator.vibrate) navigator.vibrate(50)
    }, 300)
  }, [])

  const handleNoteTouchStart = useCallback((noteId: number, title: string, e: React.TouchEvent) => {
    const touch = e.touches[0]
    startLongPress(noteId, title, touch.clientX, touch.clientY)
  }, [startLongPress])

  const handleNoteMouseDown = useCallback((noteId: number, title: string, e: React.MouseEvent) => {
    // Only respond to primary button (left click)
    if (e.button !== 0) return
    startLongPress(noteId, title, e.clientX, e.clientY)
  }, [startLongPress])

  /**
   * Shared move logic for both touch and mouse drag.
   * Updates ghost position and detects drop targets via elementFromPoint.
   */
  const handlePointerMove = useCallback((clientX: number, clientY: number, preventDefault: () => void) => {
    // Before drag: check if pointer moved enough to cancel long-press
    if (!isDraggingRef.current && touchStartRef.current) {
      const dx = clientX - touchStartRef.current.x
      const dy = clientY - touchStartRef.current.y
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
      } else if (longPressTimerRef.current) {
        // Long-press timer still active — prevent default to block iOS
        // text selection/callout that would otherwise start during the hold.
        preventDefault()
      }
      return
    }

    if (!isDraggingRef.current) return

    preventDefault()

    const elementUnder = document.elementFromPoint(clientX, clientY)

    let dropTargetCategoryId: number | 'all' | null = null
    let insertBeforeNoteId: number | null = null

    if (elementUnder) {
      const chipEl = elementUnder.closest('[data-category-id]') as HTMLElement | null
      if (chipEl) {
        const catId = chipEl.getAttribute('data-category-id')!
        dropTargetCategoryId = catId === 'all' ? 'all' : Number(catId)
      }

      if (!chipEl) {
        const noteEl = elementUnder.closest('[data-note-id]') as HTMLElement | null
        if (noteEl) {
          const hoveredNoteId = Number(noteEl.getAttribute('data-note-id'))
          if (hoveredNoteId !== dragStateRef.current?.noteId) {
            insertBeforeNoteId = hoveredNoteId
          }
        }
      }
    }

    const newState: DragState = {
      ...dragStateRef.current!,
      ghostX: clientX,
      ghostY: clientY,
      dropTargetCategoryId,
      insertBeforeNoteId,
    }
    setDragState(newState)
    dragStateRef.current = newState
  }, [])

  /**
   * Attach non-passive touchmove and mousemove listeners via useEffect.
   * touchmove needs { passive: false } to call preventDefault() on iOS.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      handlePointerMove(touch.clientX, touch.clientY, () => e.preventDefault())
    }

    const handleMouseMove = (e: MouseEvent) => {
      handlePointerMove(e.clientX, e.clientY, () => e.preventDefault())
    }

    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('mousemove', handleMouseMove)
    return () => {
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('mousemove', handleMouseMove)
    }
  }, [handlePointerMove])

  /**
   * Called on touchend — either execute the drop action or cancel.
   */
  const handleTouchEnd = useCallback(async () => {
    // Clean up long-press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    if (isDraggingRef.current && dragStateRef.current) {
      const { noteId, dropTargetCategoryId, insertBeforeNoteId } = dragStateRef.current

      if (dropTargetCategoryId !== null) {
        // ── DROP ON CATEGORY CHIP ───────────────────────────────
        // Update the note's categoryId in Dexie.
        //
        // Note: categoryId is NOT encrypted — it's just a number
        // foreign key. So we can update it directly without any
        // decrypt/encrypt cycle. The encrypted fields (title, content)
        // stay unchanged.
        const newCategoryId = dropTargetCategoryId === 'all' ? undefined : dropTargetCategoryId
        await db.notes.update(noteId, {
          categoryId: newCategoryId,
          dateModified: Date.now(),
        })
        await loadAll()

        const catName = dropTargetCategoryId === 'all'
          ? 'Uncategorized'
          : categories.find(c => c.id === dropTargetCategoryId)?.name ?? 'category'
        showToast(`Moved to ${catName}`)

      } else if (sortMode === 'manual' && insertBeforeNoteId !== null) {
        // ── REORDER (MANUAL MODE) ───────────────────────────────
        // Move the dragged note before the target note.
        // We rebuild the order by:
        //   1. Remove dragged note from the array
        //   2. Insert it before the target note
        //   3. Assign sequential order values (0, 1, 2, ...)
        //   4. Write all new order values to Dexie

        const currentOrder = filtered.map(n => n.id)
        const dragIdx = currentOrder.indexOf(noteId)
        const targetIdx = currentOrder.indexOf(insertBeforeNoteId)

        if (dragIdx !== -1 && targetIdx !== -1 && dragIdx !== targetIdx) {
          // Remove dragged note
          currentOrder.splice(dragIdx, 1)
          // Insert before target (adjust index if needed)
          const insertIdx = dragIdx < targetIdx ? targetIdx - 1 : targetIdx
          currentOrder.splice(insertIdx, 0, noteId)

          // Write new order values
          await Promise.all(
            currentOrder.map((id, index) =>
              db.notes.update(id, { order: index })
            )
          )
          await loadAll()
          showToast('Note reordered')
        }
      }
      // else: released in empty space → cancel, no change
    }

    // Reset all drag state
    isDraggingRef.current = false
    touchStartRef.current = null
    setDragState(null)
    dragStateRef.current = null
  }, [categories, sortMode, loadAll]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Cancel drag on touchcancel (e.g., incoming phone call interrupts touch)
   */
  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    isDraggingRef.current = false
    touchStartRef.current = null
    setDragState(null)
    dragStateRef.current = null
  }, [])

  // ── Filtered + sorted list ────────────────────────────────────────
  const filtered = selectedCategoryId === null
    ? notes
    : notes.filter((n) => n.categoryId === selectedCategoryId)

  const categoryMap = new Map(categories.map((c) => [c.id, c]))

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchCancel}>
      <div className="page-header">
        <h1 className="page-title">Notes</h1>
        {sortMode === 'manual' && (
          <span className="sort-mode-badge">Manual order</span>
        )}
      </div>

      {/* Category filter chips — also serve as drop targets during drag */}
      <CategoryChips
        categories={categories}
        selectedId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
        onManage={() => setManagerOpen(true)}
        sortMode={sortMode}
        dragActive={dragState !== null}
        activeDropTargetId={dragState?.dropTargetCategoryId ?? null}
      />

      {/* Add button */}
      <div className="add-btn-row">
        <button
          className="header-btn"
          onClick={() => {
            setEditNote(null)
            setSheetOpen(true)
          }}
          aria-label="Add note"
        >
          +
        </button>
      </div>

      {/* Notes list or empty state */}
      {loading ? null : filtered.length === 0 ? (
        <div className="note-list-empty">
          <div className="empty-icon">
            {selectedCategoryId !== null ? '📂' : '📝'}
          </div>
          <div className="empty-title">
            {selectedCategoryId !== null ? 'No notes in this category' : 'No notes yet'}
          </div>
          <div className="empty-subtitle">
            {selectedCategoryId !== null
              ? 'Add a note or select a different category'
              : 'Tap + to create your first note'}
          </div>
        </div>
      ) : (
        <ul className="note-list">
          {filtered.map((note) => (
            <NoteEntry
              key={note.id}
              note={note}
              category={note.categoryId ? categoryMap.get(note.categoryId) : undefined}
              onTap={setDetailNote}
              isDragging={dragState?.noteId === note.id}
              isInsertTarget={dragState?.insertBeforeNoteId === note.id}
              // Long-press to start drag (touch or mouse)
              onTouchStart={(e: React.TouchEvent) => handleNoteTouchStart(note.id, note.title, e)}
              onMouseDown={(e: React.MouseEvent) => handleNoteMouseDown(note.id, note.title, e)}
            />
          ))}
        </ul>
      )}

      {/* Drag ghost — follows the finger during drag */}
      {dragState && (
        <>
          <div className="drag-overlay" />
          <div
            className="drag-ghost"
            style={{
              left: dragState.ghostX - 80,
              top: dragState.ghostY - 30,
            }}
          >
            {dragState.noteTitle}
          </div>
        </>
      )}

      {/* Add/Edit bottom sheet */}
      <AddNoteSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false)
          setEditNote(null)
        }}
        onSave={handleSaveNote}
        editNote={editNote}
        categories={categories}
      />

      {/* Note detail overlay */}
      <NoteDetail
        note={detailNote}
        category={detailNote?.categoryId ? categoryMap.get(detailNote.categoryId) : undefined}
        onClose={() => setDetailNote(null)}
        onEdit={handleEditFromDetail}
        onDelete={handleRequestDelete}
      />

      {/* Category manager overlay */}
      <CategoryManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        categories={categories}
        onAdd={handleAddCategory}
        onRename={handleRenameCategory}
        onDelete={handleDeleteCategory}
        onChangeColor={handleChangeCategoryColor}
        sortMode={sortMode}
        onReorder={handleReorderCategories}
      />

      {/* Delete confirmation dialog */}
      {confirmDeleteId !== null && (
        <div className="confirm-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete Note</div>
            <div className="confirm-message">
              This action cannot be undone. The note will be permanently removed.
            </div>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button className="confirm-delete" onClick={() => handleDeleteNote(confirmDeleteId)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`toast${toast ? ' visible' : ''}`}>
        {toast}
      </div>
    </div>
  )
}
