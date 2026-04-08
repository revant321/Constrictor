/**
 * CategoryChips — horizontal scrollable row of category filter pills.
 *
 * Sits at the top of the Notes tab. Each chip is a glass pill tinted
 * with the category's color. The selected chip has a brighter border.
 *
 * Layout:
 *   [All] [Personal] [School] [Work] ... [⚙ Manage]
 *
 * "All" is always first and shows all notes regardless of category.
 * "Manage" is always last and opens the CategoryManager overlay.
 *
 * The color tinting works by using the category's rgba value as the
 * chip's background color — like iOS folder tints. When selected,
 * the alpha bumps up and the border brightens.
 *
 * Props:
 *   - categories: the decrypted category list
 *   - selectedId: which category is active (null = "All")
 *   - onSelect(id | null): called when user taps a chip
 *   - onManage: called when user taps the "Manage" chip
 */

import { COLOR_PALETTE, type CategoryColor } from '../pages/NotesPage'
import type { NoteSortMode } from '../services/auth'

export interface DecryptedCategory {
  id: number
  name: string
  color: CategoryColor
  order: number
  dateAdded: number
}

interface CategoryChipsProps {
  categories: DecryptedCategory[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  onManage: () => void
  sortMode?: NoteSortMode           // Controls chip sort order
  dragActive?: boolean               // True when a note is being dragged
  activeDropTargetId?: number | 'all' | null  // Which chip the finger is over
}

/**
 * CategoryChips — horizontal scrollable row of filter pills.
 *
 * Phase 8 additions:
 *   - `sortMode` controls ordering: 'date' sorts by dateAdded, 'manual' by order
 *   - `dragActive` makes all chips visually indicate they're drop targets
 *   - `activeDropTargetId` highlights the specific chip under the finger
 *   - Each chip gets a `data-category-id` attribute so the drag system can
 *     identify which chip is under the finger via document.elementFromPoint()
 */
export default function CategoryChips({
  categories, selectedId, onSelect, onManage,
  sortMode = 'date', dragActive, activeDropTargetId,
}: CategoryChipsProps) {
  // Sort categories based on the active sort mode:
  // - Date mode: by dateAdded (oldest first — stable chronological order)
  // - Manual mode: by the user-defined `order` field
  const sorted = [...categories].sort((a, b) =>
    sortMode === 'manual' ? a.order - b.order : a.dateAdded - b.dateAdded
  )

  return (
    <div className="category-chips-row">
      {/* "All" chip — always first. Dropping here removes category. */}
      <button
        className={[
          'category-chip',
          selectedId === null ? 'selected' : 'unselected',
          dragActive && 'drop-target',
          activeDropTargetId === 'all' && 'drop-target-active',
        ].filter(Boolean).join(' ')}
        data-category-id="all"
        style={selectedId === null && !dragActive ? {
          background: 'var(--glass-bg-hover)',
        } : undefined}
        onClick={() => onSelect(null)}
      >
        All
      </button>

      {/* Category chips, each tinted with its color */}
      {sorted.map((cat) => {
        const isSelected = selectedId === cat.id
        const isActiveTarget = activeDropTargetId === cat.id
        const rgba = COLOR_PALETTE[cat.color]

        return (
          <button
            key={cat.id}
            data-category-id={cat.id}
            className={[
              'category-chip',
              isSelected ? 'selected' : 'unselected',
              dragActive && 'drop-target',
              isActiveTarget && 'drop-target-active',
            ].filter(Boolean).join(' ')}
            style={isSelected && !dragActive ? {
              background: rgba.replace('0.15)', '0.25)'),
            } : {
              background: isActiveTarget
                ? rgba.replace('0.15)', '0.35)')
                : rgba,
            }}
            onClick={() => onSelect(cat.id)}
          >
            {cat.name}
          </button>
        )
      })}

      {/* "Manage" chip — not a drop target, hidden during drag */}
      {!dragActive && (
        <button className="category-chip manage" onClick={onManage}>
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Manage
        </button>
      )}
    </div>
  )
}
