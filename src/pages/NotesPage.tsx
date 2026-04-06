/**
 * NotesPage — the Notes tab. Orchestrates all note + category CRUD.
 *
 * Data flow (mirrors PasswordsPage):
 *   1. On mount, load all notes + categories from Dexie
 *   2. Decrypt encrypted fields (title, content, category name) in parallel
 *   3. Hold decrypted data in React state for rendering, filtering, sorting
 *   4. On add/edit: encrypt fields → write to Dexie → refresh decrypted list
 *   5. On delete: remove from Dexie → refresh
 *
 * Subcomponents:
 *   - CategoryChips: horizontal scrollable filter pills at the top
 *   - NoteEntry: each note card with category color left-border
 *   - AddNoteSheet: bottom sheet for add/edit note forms
 *   - NoteDetail: full-screen detail/view overlay
 *   - CategoryManager: full-screen overlay for category CRUD
 *
 * The notes list is sorted by dateModified descending (newest first).
 * Category chips filter by category; "All" shows everything.
 *
 * COLOR_PALETTE is exported from here because it's shared between
 * NotesPage, CategoryChips, NoteEntry, AddNoteSheet, and CategoryManager.
 */

import { useState, useEffect, useCallback } from 'react'
import { db } from '../services/db'
import { encrypt, decrypt } from '../services/crypto'
import { getKey } from '../services/auth'
import CategoryChips, { type DecryptedCategory } from '../components/CategoryChips'
import NoteEntry, { type DecryptedNote } from '../components/NoteEntry'
import AddNoteSheet from '../components/AddNoteSheet'
import NoteDetail from '../components/NoteDetail'
import CategoryManager from '../components/CategoryManager'

// ─── Color Palette ──────────────────────────────────────────────
// Maps color identifiers to tinted glass rgba values.
// These are the 8 predefined colors from the spec. Each category
// gets one of these colors, which is stored unencrypted in the DB.

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

// Solid versions for left-border tints on note cards — more visible
// than the 0.15 alpha glass backgrounds.
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

export default function NotesPage() {
  // ── State ──────────────────────────────────────────────────────────
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

  // ── Load & Decrypt ─────────────────────────────────────────────────
  // Load all categories and notes from Dexie, decrypt encrypted fields.
  // Categories: decrypt `name` (color is unencrypted).
  // Notes: decrypt `title` and `content`.

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
          dateAdded: row.dateAdded,
          dateModified: row.dateModified,
        }
      })
    )

    // Sort by dateModified descending — newest first.
    decrypted.sort((a, b) => b.dateModified - a.dateModified)

    return decrypted
  }, [])

  const loadAll = useCallback(async () => {
    const [cats, nts] = await Promise.all([loadCategories(), loadNotes()])
    setCategories(cats)
    setNotes(nts)
    setLoading(false)
  }, [loadCategories, loadNotes])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Add / Edit Note ────────────────────────────────────────────────
  // Encrypt title + content, write to Dexie, reload.

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
      await db.notes.add({
        title: encTitle,
        content: encContent,
        categoryId,
        dateAdded: now,
        dateModified: now,
      })
    }

    setSheetOpen(false)
    setEditNote(null)
    await loadAll()
    showToast(editNote ? 'Note updated' : 'Note added')
  }, [editNote, loadAll])

  // ── Delete Note ────────────────────────────────────────────────────

  const handleDeleteNote = useCallback(async (id: number) => {
    await db.notes.delete(id)

    if (detailNote?.id === id) setDetailNote(null)
    setConfirmDeleteId(null)
    await loadAll()
    showToast('Note deleted')
  }, [detailNote, loadAll])

  // ── Category CRUD ──────────────────────────────────────────────────
  // Called from CategoryManager. After changes, reload everything
  // (a category rename affects how notes display their category badge).

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
    // When a category is deleted, notes in that category become uncategorized.
    // We update all notes with this categoryId to undefined before deleting.
    const notesInCategory = await db.notes.where('categoryId').equals(id).toArray()
    await Promise.all(
      notesInCategory.map((n) => db.notes.update(n.id!, { categoryId: undefined }))
    )

    await db.noteCategories.delete(id)

    // If the user was filtering by this category, reset to "All"
    if (selectedCategoryId === id) setSelectedCategoryId(null)

    await loadAll()
    showToast('Category deleted')
  }, [selectedCategoryId, loadAll])

  const handleChangeCategoryColor = useCallback(async (id: number, color: CategoryColor) => {
    await db.noteCategories.update(id, { color })
    await loadAll()
  }, [loadAll])

  // ── Toast ──────────────────────────────────────────────────────────

  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 2000)
  }

  // ── Open edit from detail ──────────────────────────────────────────

  const handleEditFromDetail = useCallback((note: DecryptedNote) => {
    setDetailNote(null)
    setEditNote(note)
    setTimeout(() => setSheetOpen(true), 100)
  }, [])

  const handleRequestDelete = useCallback((id: number) => {
    setConfirmDeleteId(id)
  }, [])

  // ── Filtered list ──────────────────────────────────────────────────
  // Filter notes by selected category. "All" (null) shows everything.

  const filtered = selectedCategoryId === null
    ? notes
    : notes.filter((n) => n.categoryId === selectedCategoryId)

  // Build a lookup map from category ID → decrypted category for display.
  const categoryMap = new Map(categories.map((c) => [c.id, c]))

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Notes</h1>
      </div>

      {/* Category filter chips */}
      <CategoryChips
        categories={categories}
        selectedId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
        onManage={() => setManagerOpen(true)}
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
            />
          ))}
        </ul>
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
    </>
  )
}
