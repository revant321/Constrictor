/**
 * SearchBar — glass-styled search input with magnifying glass icon.
 *
 * This is a simple controlled input. Filtering logic lives in the parent
 * (PasswordsPage) — we just pass the value up via onChange. No debounce
 * needed because the password list is small and already decrypted in memory,
 * so filtering is just a .filter() on an array — instant.
 */

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchBar({ value, onChange, placeholder = 'Search' }: SearchBarProps) {
  return (
    <div className="search-wrapper">
      {/* Magnifying glass icon positioned absolutely inside the input */}
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        className="search-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
