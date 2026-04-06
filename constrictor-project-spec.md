# Constrictor — Project Spec

> A simple, secure, local-first password manager. Named after the constrictor knot: highly secure yet simple to tie.

---

## Overview

Constrictor is a personal password manager PWA that runs on iPhone (Safari) and MacBook. All data is encrypted and stored locally on each device. No cloud, no accounts, no backdoors.

## Tech Stack

- **Framework:** React 18 + TypeScript + Vite (PWA)
- **Storage:** Dexie.js (IndexedDB)
- **Encryption:** Web Crypto API (AES-GCM + PBKDF2)
- **Routing:** React Router
- **Target:** iPhone Safari PWA + Mac browser

## Design Direction — Liquid Glass-Inspired UI

The app's visual language is inspired by Apple's Liquid Glass design system (WWDC 2025). Since this is a web PWA and not a native app, we approximate the aesthetic using CSS techniques rather than native APIs.

### Core CSS Techniques
- `backdrop-filter: blur(12-20px)` + `-webkit-backdrop-filter` for frosted translucency
- Semi-transparent backgrounds: `rgba(255, 255, 255, 0.15-0.25)` (light) / `rgba(255, 255, 255, 0.06-0.12)` (dark)
- Generous `border-radius` (16-24px) for rounded, floating shapes
- Subtle glass edge borders: `1px solid rgba(255, 255, 255, 0.18)`
- Soft layered `box-shadow` for elevation and depth
- Smooth transitions on interactive elements

### Where to Apply Glass
Following Apple's own guidance, Liquid Glass is reserved for the **navigation and control layer** — not everything:
- ✅ Bottom navigation bar
- ✅ PIN pad and lock screen controls
- ✅ Search bar
- ✅ Modal dialogs and action sheets
- ✅ Floating action buttons
- ✅ Settings cards/sections
- ❌ Content lists (passwords, notes) — these stay clean and readable
- ❌ Text input fields within forms — clarity over style
- ❌ Every background surface — avoid muddying hierarchy

### What We Cannot Replicate
- Real-time lensing/refraction that responds to device tilt (requires native Apple silicon APIs)
- Dynamic light spill from surrounding content onto glass surfaces
- The exact specular highlight behavior of native Liquid Glass

### Color & Theme
- Dark mode primary (suits a security app — feels serious and premium)
- Accent color: cool blue-green or teal (evokes trust/security)
- Background: deep gradient (dark navy/charcoal) to give glass elements something to float over
- Text: high-contrast white/light gray on dark surfaces — readability is non-negotiable

---

## Security Model

### Authentication
- **6-digit PIN** entered on a numeric keypad (iPhone-style)
- **Master password** entered as text
- Both are set during first-time setup
- Both are required every time the app is unlocked
- No "forgot password" recovery — losing credentials = losing data (by design)

### Encryption
- The master password + PIN are combined and run through **PBKDF2** to derive an AES-256-GCM encryption key
- A random **salt** is generated during setup and stored unencrypted in IndexedDB
- A **verification token** (a known string encrypted with the derived key) is stored during setup — on login, the app tries to decrypt it to confirm credentials are correct
- Every vault entry (passwords and secure notes) is individually encrypted before storage
- Raw credentials never touch disk — only the derived key exists in memory while the app is unlocked

### Lock Behavior
- **Default:** App locks when closed (terminated / swiped away)
- **Optional setting:** App locks when sent to background (home screen / tab switch)
- Locking = derived key is wiped from memory → must re-authenticate

## Data Model

### Table: `meta`
Stores app configuration (unencrypted):
| Field | Type | Description |
|-------|------|-------------|
| key | string | Setting name (primary key) |
| value | any | Setting value |

Keys stored here:
- `salt` — PBKDF2 salt (Uint8Array)
- `verificationToken` — encrypted known string for credential verification
- `lockBehavior` — `"close"` or `"background"`
- `setupComplete` — boolean

### Table: `passwords`
| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment | Primary key |
| siteName | string | Encrypted — display name (e.g., "Netflix") |
| username | string | Encrypted |
| password | string | Encrypted |
| dateAdded | number | Timestamp |
| dateModified | number | Timestamp |

### Table: `noteCategories`
| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment | Primary key |
| name | string | Encrypted — category name (e.g., "Personal", "School") |
| color | string | NOT encrypted — CSS color identifier (e.g., "blue", "rose", "amber") used for tinted glass background |
| order | number | Display order |
| dateAdded | number | Timestamp |

Predefined color palette (maps to tinted glass rgba values):
- `blue` — rgba(59, 130, 246, 0.15)
- `purple` — rgba(168, 85, 247, 0.15)
- `rose` — rgba(244, 63, 94, 0.15)
- `amber` — rgba(245, 158, 11, 0.15)
- `emerald` — rgba(16, 185, 129, 0.15)
- `cyan` — rgba(6, 182, 212, 0.15)
- `orange` — rgba(249, 115, 22, 0.15)
- `pink` — rgba(236, 72, 153, 0.15)

Each color gets the same glass treatment (backdrop-filter, border, shadow) but with its color as the tinted background — like iOS folder tints.

### Table: `notes`
| Field | Type | Description |
|-------|------|-------------|
| id | auto-increment | Primary key |
| categoryId | number | Foreign key → noteCategories.id (nullable — uncategorized notes allowed) |
| title | string | Encrypted |
| content | string | Encrypted |
| dateAdded | number | Timestamp |
| dateModified | number | Timestamp |

> Note: `siteName`, `title`, and category `name` are encrypted at rest but decrypted into memory when the app is unlocked, enabling search and sorting in-app. Category `color` is NOT encrypted since it contains no sensitive info and is needed for rendering before full decryption.

## App Structure

```
/ (root)
├── First-Time Setup Flow (if no vault exists)
│   ├── Welcome screen
│   ├── Create PIN (6-digit keypad)
│   ├── Confirm PIN
│   ├── Create master password
│   ├── Confirm master password
│   └── Setup complete → auto-login
│
├── Lock Screen (if vault exists)
│   ├── PIN entry (numeric keypad)
│   └── Master password entry
│
├── Main App (after unlock)
│   ├── Bottom Nav: Passwords | Notes | Settings
│   │
│   ├── Passwords Tab
│   │   ├── Search bar (filters by site name)
│   │   ├── Alphabetical list of entries
│   │   ├── Tap entry → view details (username, password with show/hide toggle, copy buttons)
│   │   ├── Add new entry (FAB or header button)
│   │   └── Edit / Delete entry
│   │
│   ├── Notes Tab
│   │   ├── Category chips/pills at top (horizontal scroll, colored glass, "All" selected by default)
│   │   ├── "Manage Categories" option (add/rename/reorder/delete categories, pick color)
│   │   ├── Notes list filtered by selected category, sorted by date last edited (newest first)
│   │   ├── Each note card shows a subtle left-border tint matching its category color
│   │   ├── Tap note → view/edit (can reassign category)
│   │   ├── Add new note (with category picker)
│   │   └── Delete note
│   │
│   └── Settings Tab
│       ├── Lock behavior: "Lock on close" vs "Lock on background"
│       ├── Change PIN (requires current PIN + password)
│       ├── Change master password (requires current PIN + password)
│       ├── Export vault (encrypted JSON file)
│       ├── Import vault (decrypt with credentials)
│       └── (empty space for future settings)
```

## Encrypted Transfer (Export/Import)

### Export
1. User taps "Export Vault" in Settings
2. App serializes all passwords + notes as JSON
3. JSON is encrypted using the current derived key
4. Output: a single `.constrictor` file (just encrypted JSON with a custom extension)
5. User transfers via AirDrop, USB, email, etc.

### Import
1. User taps "Import Vault" on the target device
2. User selects the `.constrictor` file
3. App prompts for the PIN + master password that were used on the source device
4. App derives the key from those credentials + the salt embedded in the file
5. Decrypts and merges entries into the local vault (or replaces — TBD)
6. Re-encrypts everything with the local device's key

### Export File Format
```json
{
  "version": 1,
  "salt": "<base64>",
  "iv": "<base64>",
  "data": "<base64 encrypted JSON of { passwords: [...], notes: [...] }>"
}
```

## Phases

| Phase | Scope | Key Deliverables |
|-------|-------|-----------------|
| 1 | Setup + Auth | Project scaffold, Dexie schema, first-time setup flow, lock screen, PBKDF2 key derivation, verification token |
| 2 | Encryption Layer | Encrypt/decrypt utility functions, individual field encryption, key management in memory |
| 3 | Passwords | Add/view/edit/delete entries, search, alphabetical list, copy-to-clipboard, show/hide toggle |
| 4 | Secure Notes | Note categories (create/edit/delete, color picker), add/view/edit/delete notes with category assignment, date-sorted list, category filter chips |
| 5 | Settings | Lock behavior toggle, change PIN, change master password |
| 6 | Export/Import | Encrypted file export, import with credential prompt, merge logic |
| 7 | PWA Polish | Manifest, icons, Liquid Glass UI polish pass, install prompt, final testing on iPhone + Mac |
| 8 | Drag & Drop + Sort Modes (Future) | Drag-and-drop notes onto category chips to reassign, note sort modes setting (Date/Manual), manual note reordering via drag, category ordering follows sort mode |

## Phase 8 — Drag & Drop + Sort Modes (Future / Post-Launch)

These features are planned for after the initial launch. Do NOT implement until Phases 1–7 are complete.

### 8.1 Drag and Drop Notes into Categories
- Users can drag a note card and drop it onto a category chip to reassign its category.
- Works regardless of the current sort mode (Date or Manual).
- Visual feedback: category chip highlights on drag-over to indicate a valid drop target.
- Dropping onto "All" chip removes the note's category (sets categoryId to null).

### 8.2 Note Sort Modes (New Setting)
- A new setting in the Settings tab: **Note Sort Mode** with two options:
  - **Date** (default) — notes sorted by `dateModified` descending (newest first). This is the current behavior.
  - **Manual** — notes get an `order` field (number) and can be reordered via drag and drop within the list.
- When switching from Date to Manual for the first time, notes are assigned `order` values based on their current date-sorted positions.
- The sort mode preference is stored in the `meta` table as `noteSortMode` (`"date"` | `"manual"`).
- Schema change (future): add `order` field to `notes` table.

### 8.3 Category Ordering Follows Sort Mode
- In **Date** mode: categories sort by `dateAdded` (oldest first).
- In **Manual** mode: categories use their existing `order` field and can be reordered via drag and drop in the Manage Categories screen.
- The same `noteSortMode` setting controls both note and category ordering — no separate toggle.

## UI/UX Notes

- Dark mode only (at least initially)
- Liquid Glass styling on navigation/control layers; clean flat content areas
- PIN pad should feel native — large circular buttons, haptic-style feedback via CSS transitions
- Password entries: show site icon/favicon if feasible, otherwise first-letter avatar
- Copy-to-clipboard should show brief toast confirmation
- All animations should be subtle and fast (150-250ms)
- Touch targets minimum 44x44px per Apple HIG
- Note category chips: horizontal scrollable row with colored glass pill shapes, "All" chip first

### iOS-Native Feel Guidelines
The app should feel indistinguishable from a native iOS app. Key behaviors:
- **Page transitions:** slide-in from right (push), slide-out to right (pop) — like UINavigationController
- **Pull-to-refresh:** where applicable (e.g., notes list after import)
- **Swipe actions:** swipe left on list items to reveal delete/edit — like iOS Mail
- **Sheet modals:** "Add new" forms slide up from bottom as a sheet, not a full page redirect
- **Safe area insets:** respect `env(safe-area-inset-*)` for notch/home indicator
- **Font:** use `-apple-system, BlinkMacSystemFont, 'SF Pro'` system font stack
- **Rubber-band scrolling:** use `-webkit-overflow-scrolling: touch` for native momentum
- **No hover states on mobile:** interaction feedback via opacity/scale on `:active` instead
- **Status bar:** PWA meta tags to blend status bar with app background
- **Haptic feedback:** use `navigator.vibrate()` on PIN button press where supported

## Constraints

- Total app size: under 1 GB (realistically will be under 10 MB)
- No cloud dependencies
- No AI integration
- No recovery mechanism — this is intentional
- Data lives independently on each device

## File Structure (Planned)
```
constrictor/
├── public/
│   └── icons/
├── src/
│   ├── components/
│   │   ├── PinPad.tsx
│   │   ├── PasswordEntry.tsx
│   │   ├── NoteEntry.tsx
│   │   ├── CategoryChips.tsx
│   │   ├── CategoryManager.tsx
│   │   ├── SearchBar.tsx
│   │   └── GlassCard.tsx
│   ├── pages/
│   │   ├── SetupFlow.tsx
│   │   ├── LockScreen.tsx
│   │   ├── PasswordsPage.tsx
│   │   ├── NotesPage.tsx
│   │   └── SettingsPage.tsx
│   ├── services/
│   │   ├── crypto.ts        (PBKDF2, AES-GCM encrypt/decrypt)
│   │   ├── db.ts            (Dexie schema + operations)
│   │   └── auth.ts          (login, lock, key management)
│   ├── hooks/
│   │   └── useAuth.ts       (auth state, lock listeners)
│   ├── styles/
│   │   └── glass.css        (Liquid Glass utility classes)
│   ├── App.tsx
│   └── main.tsx
├── constrictor-project-spec.md
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
└── vite.config.ts
```
