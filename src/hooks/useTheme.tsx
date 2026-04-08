/**
 * useTheme — React context for appearance/theme management.
 *
 * Supports three modes stored in the Dexie `meta` table:
 *   "system" (default) — follows the OS preference via prefers-color-scheme
 *   "light"  — always light mode
 *   "dark"   — always dark mode
 *
 * The resolved theme ("light" | "dark") is applied as a `data-theme` attribute
 * on <html>. CSS variables defined in index.css respond to this attribute,
 * so every glass element, text color, and background updates automatically.
 *
 * In "system" mode, we listen for matchMedia changes (e.g., the user toggles
 * their Mac's appearance in System Settings) and update in real time.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { db } from '../services/db'

export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  /** The user's chosen preference: system, light, or dark */
  appearance: Appearance
  /** The actual applied theme after resolving "system" */
  theme: ResolvedTheme
  /** Update the preference (persists to IndexedDB) */
  setAppearance: (appearance: Appearance) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Read the system's dark mode preference */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Resolve an appearance preference to an actual theme */
function resolveTheme(appearance: Appearance): ResolvedTheme {
  if (appearance === 'system') return getSystemTheme()
  return appearance
}

/** Apply the theme to the DOM */
function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light')
  } else {
    root.removeAttribute('data-theme')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>('system')
  const [theme, setTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  // ── Load saved preference on mount ───────────────────────────────
  useEffect(() => {
    async function load() {
      const entry = await db.meta.get('appearance')
      const saved = (entry?.value as Appearance) ?? 'system'
      setAppearanceState(saved)
      const resolved = resolveTheme(saved)
      setTheme(resolved)
      applyTheme(resolved)
    }
    load()
  }, [])

  // ── Listen for OS theme changes when in "system" mode ────────────
  useEffect(() => {
    if (appearance !== 'system') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const newTheme: ResolvedTheme = e.matches ? 'dark' : 'light'
      setTheme(newTheme)
      applyTheme(newTheme)
    }

    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [appearance])

  // ── Persist preference ───────────────────────────────────────────
  const handleSetAppearance = useCallback(async (newAppearance: Appearance) => {
    setAppearanceState(newAppearance)
    const resolved = resolveTheme(newAppearance)
    setTheme(resolved)
    applyTheme(resolved)
    await db.meta.put({ key: 'appearance', value: newAppearance })
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        appearance,
        theme,
        setAppearance: handleSetAppearance,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
