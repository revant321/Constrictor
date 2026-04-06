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
}

export default function CategoryChips({ categories, selectedId, onSelect, onManage }: CategoryChipsProps) {
  const sorted = [...categories].sort((a, b) => a.order - b.order)

  return (
    <div className="category-chips-row">
      {/* "All" chip — always first */}
      <button
        className={`category-chip ${selectedId === null ? 'selected' : 'unselected'}`}
        style={selectedId === null ? {
          background: 'rgba(45, 212, 191, 0.15)',
        } : undefined}
        onClick={() => onSelect(null)}
      >
        All
      </button>

      {/* Category chips, each tinted with its color */}
      {sorted.map((cat) => {
        const isSelected = selectedId === cat.id
        const rgba = COLOR_PALETTE[cat.color]

        return (
          <button
            key={cat.id}
            className={`category-chip ${isSelected ? 'selected' : 'unselected'}`}
            style={isSelected ? {
              background: rgba.replace('0.15)', '0.25)'),
            } : {
              background: rgba,
            }}
            onClick={() => onSelect(cat.id)}
          >
            {cat.name}
          </button>
        )
      })}

      {/* "Manage" chip — opens category manager */}
      <button className="category-chip manage" onClick={onManage}>
        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        Manage
      </button>
    </div>
  )
}
