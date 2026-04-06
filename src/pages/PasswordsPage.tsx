/**
 * PasswordsPage — the Passwords tab. Orchestrates all password CRUD.
 *
 * Data flow:
 *   1. On mount, load all rows from the `passwords` Dexie table
 *   2. Decrypt every field (siteName, username, password) using the in-memory key
 *   3. Hold the decrypted list in React state for rendering, search, and sort
 *   4. On add/edit: encrypt fields → write to Dexie → refresh decrypted list
 *   5. On delete: remove from Dexie → refresh decrypted list
 *
 * The decrypted data only lives in React state (RAM). When the app locks,
 * the component unmounts and state is garbage collected — nothing persists.
 *
 * Subcomponents:
 *   - SearchBar: filters the list by site name (case-insensitive substring match)
 *   - PasswordEntry: each list item (swipe-to-delete, tap to open detail)
 *   - AddPasswordSheet: bottom sheet for add/edit forms
 *   - PasswordDetail: full-screen detail view with copy + show/hide
 *
 * The list is sorted alphabetically by site name and grouped by first letter
 * with sticky section headers (like iOS Contacts).
 */

import { useState, useEffect, useCallback } from 'react'
import { db } from '../services/db'
import { encrypt, decrypt } from '../services/crypto'
import { getKey } from '../services/auth'
import SearchBar from '../components/SearchBar'
import PasswordEntry, { type DecryptedPassword } from '../components/PasswordEntry'
import AddPasswordSheet from '../components/AddPasswordSheet'
import PasswordDetail from '../components/PasswordDetail'

export default function PasswordsPage() {
  // ── State ──────────────────────────────────────────────────────────

  /** All passwords, decrypted and ready for display */
  const [passwords, setPasswords] = useState<DecryptedPassword[]>([])
  /** Search query — filters by site name */
  const [search, setSearch] = useState('')
  /** Whether the add/edit sheet is open */
  const [sheetOpen, setSheetOpen] = useState(false)
  /** The entry being edited (null = add mode) */
  const [editEntry, setEditEntry] = useState<DecryptedPassword | null>(null)
  /** The entry shown in the detail view (null = closed) */
  const [detailEntry, setDetailEntry] = useState<DecryptedPassword | null>(null)
  /** Toast message (empty = hidden) */
  const [toast, setToast] = useState('')
  /** ID of the entry pending delete confirmation (null = no confirm dialog) */
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  /** Loading state for initial decrypt */
  const [loading, setLoading] = useState(true)

  // ── Load & Decrypt ─────────────────────────────────────────────────
  //
  // On mount (and after any CRUD operation), we read all rows from Dexie
  // and decrypt every encrypted field. This gives us a plain JS array
  // that we can sort, filter, and render without touching crypto again.
  //
  // Why decrypt everything upfront? Because the list needs to be sorted
  // alphabetically by site name and searchable — both require plaintext.
  // With a typical password manager holding < 200 entries, decrypting
  // all of them takes < 50ms. If this ever became a bottleneck (1000+
  // entries), we'd add pagination or virtual scrolling.

  const loadPasswords = useCallback(async () => {
    const key = getKey()
    if (!key) return // shouldn't happen — we're inside the unlocked gate

    const rows = await db.passwords.toArray()

    // Decrypt all fields in parallel for each row.
    // Promise.all on the outer array processes all rows concurrently.
    // For each row, we decrypt its 3 encrypted fields in parallel too.
    const decrypted = await Promise.all(
      rows.map(async (row) => {
        const [siteName, username, password] = await Promise.all([
          decrypt(row.siteName, key),
          decrypt(row.username, key),
          decrypt(row.password, key),
        ])
        return {
          id: row.id!,
          siteName,
          username,
          password,
          dateAdded: row.dateAdded,
          dateModified: row.dateModified,
        }
      })
    )

    // Sort alphabetically by site name (case-insensitive).
    decrypted.sort((a, b) => a.siteName.localeCompare(b.siteName, undefined, { sensitivity: 'base' }))

    setPasswords(decrypted)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPasswords()
  }, [loadPasswords])

  // ── Add / Edit ─────────────────────────────────────────────────────
  //
  // When the user saves from the bottom sheet, we:
  //   1. Get the encryption key from memory
  //   2. Encrypt each field individually (site name, username, password)
  //   3. Write to Dexie (add = new row, edit = update existing)
  //   4. Reload the full list (re-decrypt) to keep state in sync
  //
  // We re-encrypt on every save even for edit, because AES-GCM uses a
  // fresh random IV each time — so the ciphertext changes even if the
  // plaintext didn't. This is actually a security feature: it prevents
  // an observer from knowing whether a field was modified.

  const handleSave = useCallback(async (siteName: string, username: string, password: string) => {
    const key = getKey()
    if (!key) return

    // Encrypt all three fields in parallel.
    const [encSite, encUser, encPass] = await Promise.all([
      encrypt(siteName, key),
      encrypt(username, key),
      encrypt(password, key),
    ])

    const now = Date.now()

    if (editEntry) {
      // Edit mode — update the existing row in Dexie.
      await db.passwords.update(editEntry.id, {
        siteName: encSite,
        username: encUser,
        password: encPass,
        dateModified: now,
      })
    } else {
      // Add mode — insert a new row.
      await db.passwords.add({
        siteName: encSite,
        username: encUser,
        password: encPass,
        dateAdded: now,
        dateModified: now,
      })
    }

    // Close the sheet and reload.
    setSheetOpen(false)
    setEditEntry(null)
    await loadPasswords()

    showToast(editEntry ? 'Password updated' : 'Password added')
  }, [editEntry, loadPasswords])

  // ── Delete ─────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (id: number) => {
    await db.passwords.delete(id)

    // If we were viewing this entry in the detail view, close it.
    if (detailEntry?.id === id) {
      setDetailEntry(null)
    }

    setConfirmDeleteId(null)
    await loadPasswords()
    showToast('Password deleted')
  }, [detailEntry, loadPasswords])

  // ── Toast ──────────────────────────────────────────────────────────
  //
  // Brief confirmation message that auto-dismisses after 2 seconds.

  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 2000)
  }

  // ── Open edit sheet from detail view ───────────────────────────────

  const handleEditFromDetail = useCallback((entry: DecryptedPassword) => {
    setDetailEntry(null) // close detail view
    setEditEntry(entry)
    // Small delay so the detail slide-out animation finishes before
    // the sheet slides up — prevents visual jank from overlapping transitions.
    setTimeout(() => setSheetOpen(true), 100)
  }, [])

  // ── Delete confirmation from detail view or swipe ──────────────────

  const handleRequestDelete = useCallback((id: number) => {
    setConfirmDeleteId(id)
  }, [])

  // ── Filtered + Grouped List ────────────────────────────────────────
  //
  // Filter by search query (case-insensitive substring match on site name),
  // then group by first letter for section headers.

  const filtered = search
    ? passwords.filter((p) =>
        p.siteName.toLowerCase().includes(search.toLowerCase())
      )
    : passwords

  // Group into sections: { letter: string, entries: DecryptedPassword[] }[]
  const sections: { letter: string; entries: DecryptedPassword[] }[] = []
  let currentLetter = ''
  for (const entry of filtered) {
    const letter = entry.siteName.charAt(0).toUpperCase()
    if (letter !== currentLetter) {
      currentLetter = letter
      sections.push({ letter, entries: [] })
    }
    sections[sections.length - 1].entries.push(entry)
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      {/* Page header with title */}
      <div className="page-header">
        <h1 className="page-title">Passwords</h1>
      </div>

      {/* Search bar — filters the list as you type */}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search passwords"
      />

      {/* Add button — left-aligned below search */}
      <div className="add-btn-row">
        <button
          className="header-btn"
          onClick={() => {
            setEditEntry(null)
            setSheetOpen(true)
          }}
          aria-label="Add password"
        >
          +
        </button>
      </div>

      {/* Password list or empty state */}
      {loading ? null : filtered.length === 0 ? (
        <div className="password-list-empty">
          <div className="empty-icon">
            {search ? '🔍' : '🔐'}
          </div>
          <div className="empty-title">
            {search ? 'No matches' : 'No passwords yet'}
          </div>
          <div className="empty-subtitle">
            {search
              ? `Nothing matches "${search}"`
              : 'Tap + to add your first password'}
          </div>
        </div>
      ) : (
        <ul className="password-list">
          {sections.map((section) => (
            <li key={section.letter}>
              <div className="section-letter">{section.letter}</div>
              <ul className="password-list">
                {section.entries.map((entry) => (
                  <PasswordEntry
                    key={entry.id}
                    entry={entry}
                    onTap={setDetailEntry}
                    onDelete={handleRequestDelete}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {/* Add/Edit bottom sheet */}
      <AddPasswordSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false)
          setEditEntry(null)
        }}
        onSave={handleSave}
        editEntry={editEntry}
      />

      {/* Detail view — slides in from right */}
      <PasswordDetail
        entry={detailEntry}
        onClose={() => setDetailEntry(null)}
        onEdit={handleEditFromDetail}
        onDelete={handleRequestDelete}
        onToast={showToast}
      />

      {/* Delete confirmation dialog */}
      {confirmDeleteId !== null && (
        <div className="confirm-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete Password</div>
            <div className="confirm-message">
              This action cannot be undone. The password entry will be permanently removed.
            </div>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button className="confirm-delete" onClick={() => handleDelete(confirmDeleteId)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      <div className={`toast${toast ? ' visible' : ''}`}>
        {toast}
      </div>
    </>
  )
}
