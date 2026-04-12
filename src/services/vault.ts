/**
 * Vault export/import service — Phase 6.
 *
 * Handles the .constrictor encrypted file format:
 *
 *   {
 *     "version": 1,
 *     "salt": "<base64>",    — PBKDF2 salt from the source device
 *     "iv": "<base64>",      — AES-GCM IV used to encrypt the data blob
 *     "data": "<base64>"     — encrypted JSON containing all vault entries
 *   }
 *
 * Export flow:
 *   1. Decrypt all vault entries with the current in-memory key
 *   2. Serialize the plaintext data as JSON
 *   3. Encrypt the JSON blob with a fresh IV using the current key
 *   4. Package with the device's salt and download as .constrictor
 *
 * Import flow:
 *   1. Parse the .constrictor file
 *   2. Derive the source key from user-provided PIN + password + embedded salt
 *   3. Decrypt the JSON blob
 *   4. Re-encrypt every field with the LOCAL device's key
 *   5. Insert into the local DB (additive merge — new entries only)
 *
 * The reason we encrypt the entire JSON blob as one unit (rather than
 * keeping individual field encryption) is simplicity: one encrypt/decrypt
 * operation for the whole file, and the plaintext structure is clean JSON
 * that's easy to validate after decryption.
 */

import { db } from './db'
import { getKey } from './auth'
import { decrypt, encrypt, deriveKey, uint8ToBase64, base64ToUint8 } from './crypto'

// ─── File format types ────────────────────────────────────────────

/** The .constrictor file structure (JSON on disk). */
interface ConstrictorFile {
  version: number
  salt: string   // base64-encoded PBKDF2 salt
  iv: string     // base64-encoded AES-GCM IV
  data: string   // base64-encoded ciphertext
}

/**
 * The plaintext vault data inside the encrypted blob.
 *
 * Category entries include their source `id` so that notes'
 * `categoryId` references can be remapped after import (since
 * auto-increment IDs differ between devices).
 */
interface VaultData {
  passwords: Array<{
    siteName: string
    siteUrl?: string
    username: string
    password: string
    dateAdded: number
    dateModified: number
  }>
  notes: Array<{
    categoryId?: number
    title: string
    content: string
    dateAdded: number
    dateModified: number
  }>
  noteCategories: Array<{
    id: number        // source device's auto-increment ID (for mapping)
    name: string
    color: string
    order: number
    dateAdded: number
  }>
}

// AES-GCM IV length — same as in crypto.ts
const IV_LENGTH = 12

// ─── Export ───────────────────────────────────────────────────────

/**
 * Exports the entire vault as an encrypted .constrictor file.
 *
 * The process:
 *   1. Read the salt and all entries from IndexedDB
 *   2. Decrypt every encrypted field back to plaintext
 *   3. Build a clean JSON structure with the plaintext data
 *   4. Encrypt the JSON string with AES-GCM using a fresh IV
 *   5. Package into the .constrictor format and trigger a download
 *
 * We encrypt the data blob directly with Web Crypto (not the per-field
 * encrypt() function) because the spec wants separate `iv` and `data`
 * fields in the file, whereas encrypt() combines them into one string.
 */
export async function exportVault(): Promise<void> {
  const key = getKey()
  if (!key) throw new Error('Vault is locked')

  // Read the salt — we include it in the export so the importer can
  // derive the same key using the source credentials + this salt.
  const saltEntry = await db.meta.get('salt')
  if (!saltEntry) throw new Error('No salt found')
  const salt = new Uint8Array(saltEntry.value as number[])

  // Read all vault entries from IndexedDB.
  const passwords = await db.passwords.toArray()
  const notes = await db.notes.toArray()
  const categories = await db.noteCategories.toArray()

  // Decrypt all fields back to plaintext.
  // Each field was individually encrypted with the current key —
  // we reverse that to get clean strings for the export JSON.
  const decryptedPasswords = await Promise.all(
    passwords.map(async (p) => ({
      siteName: await decrypt(p.siteName, key),
      siteUrl: p.siteUrl ? await decrypt(p.siteUrl, key) : undefined,
      username: await decrypt(p.username, key),
      password: await decrypt(p.password, key),
      dateAdded: p.dateAdded,
      dateModified: p.dateModified,
    })),
  )

  const decryptedNotes = await Promise.all(
    notes.map(async (n) => ({
      categoryId: n.categoryId,
      title: await decrypt(n.title, key),
      content: await decrypt(n.content, key),
      dateAdded: n.dateAdded,
      dateModified: n.dateModified,
    })),
  )

  // Categories: include the source `id` so we can remap note categoryIds
  // when importing on a different device (where IDs will differ).
  const decryptedCategories = await Promise.all(
    categories.map(async (c) => ({
      id: c.id!,
      name: await decrypt(c.name, key),
      color: c.color,
      order: c.order,
      dateAdded: c.dateAdded,
    })),
  )

  const vaultData: VaultData = {
    passwords: decryptedPasswords,
    notes: decryptedNotes,
    noteCategories: decryptedCategories,
  }

  // Encrypt the entire JSON blob with a fresh IV.
  // We use the raw Web Crypto API here (not our encrypt() helper) because
  // the .constrictor file format wants `iv` and `data` as separate fields.
  const json = JSON.stringify(vaultData)
  const encoded = new TextEncoder().encode(json)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer },
    key,
    encoded.buffer,
  )

  // Build the .constrictor file.
  const file: ConstrictorFile = {
    version: 1,
    salt: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  }

  // Trigger browser download.
  // We create a temporary <a> element, set its href to a blob URL,
  // click it programmatically, then clean up. This is the standard
  // way to trigger downloads from JavaScript without a server.
  const blob = new Blob(
    [JSON.stringify(file, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `constrictor-vault-${new Date().toISOString().slice(0, 10)}.constrictor`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Import ──────────────────────────────────────────────────────

/**
 * Imports a .constrictor file into the local vault.
 *
 * The tricky parts:
 *
 *   1. Key derivation: We derive the SOURCE key using the credentials
 *      the user entered + the salt embedded in the file. This key may
 *      differ from the local key if the devices had different salts or
 *      credentials (which they will unless it's the exact same setup).
 *
 *   2. Category ID mapping: The source device's category IDs are auto-
 *      incremented and won't match the local device's IDs. When we insert
 *      imported categories, Dexie assigns new IDs. We build a map of
 *      sourceId → newLocalId and use it to fix up note `categoryId` values.
 *
 *   3. Additive merge: All imported entries are added as new rows. We don't
 *      try to deduplicate — since everything is encrypted differently per
 *      device, there's no reliable way to detect duplicates. The user can
 *      manually remove any duplicates after import.
 *
 * @param fileContent - Raw string content of the .constrictor file
 * @param pin - PIN used on the SOURCE device
 * @param masterPassword - Master password used on the SOURCE device
 * @returns Counts of imported entries for the success message
 */
export async function importVault(
  fileContent: string,
  pin: string,
  masterPassword: string,
): Promise<{ passwords: number; notes: number; categories: number }> {
  // ── Stage 1: Parse the file ─────────────────────────────────────
  //
  // iOS Safari's FileReader can sometimes prepend a UTF-8 BOM character
  // (\uFEFF) or include trailing whitespace/newlines that break JSON.parse.
  // We strip those before parsing to handle cross-platform edge cases.

  let file: ConstrictorFile
  try {
    console.log('Import: parsing file')
    const cleaned = fileContent.trim().replace(/^\uFEFF/, '')
    file = JSON.parse(cleaned)
  } catch (err) {
    console.error('Import: parsing file failed', err)
    throw new Error(`File parsing failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (file.version !== 1) {
    throw new Error(`Unsupported file version: ${file.version}`)
  }
  if (!file.salt || !file.iv || !file.data) {
    throw new Error('Invalid file format: missing required fields')
  }

  // ── Stage 2: Derive the source key ──────────────────────────────
  //
  // The salt from the file is base64-encoded. We decode it to a Uint8Array
  // before passing to deriveKey. If this step produces an incorrect key
  // (e.g., corrupted base64), decryption will fail in the next stage.

  let sourceKey: CryptoKey
  try {
    console.log('Import: deriving key')
    const rawSalt = base64ToUint8(file.salt)
    // Validate salt is a reasonable length (our PBKDF2 uses 16-byte salts)
    if (rawSalt.length === 0) {
      throw new Error('Salt decoded to empty array — possible base64 corruption')
    }
    // Construct a fresh Uint8Array — iOS Safari requires the backing ArrayBuffer
    // to be owned by this context. base64ToUint8 already creates a new one, but
    // we double-ensure with new Uint8Array(raw) for safety.
    const sourceSalt = new Uint8Array(rawSalt)
    sourceKey = await deriveKey(pin, masterPassword, sourceSalt)
  } catch (err) {
    console.error('Import: deriving key failed', err)
    throw new Error(`Key derivation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Stage 3: Decrypt the data blob ──────────────────────────────
  //
  // AES-GCM decryption. If the credentials are wrong, the authentication
  // tag won't match and crypto.subtle.decrypt throws a DOMException with
  // "The operation failed" — an intentionally vague message from Web Crypto.

  let decryptedBytes: ArrayBuffer
  try {
    console.log('Import: decrypting')
    // Construct fresh Uint8Arrays — iOS Safari's Web Crypto is strict about
    // ArrayBuffer ownership. Passing a typed array that's a view into a larger
    // buffer (or from a different execution context) causes "operation failed".
    const iv = new Uint8Array(base64ToUint8(file.iv))
    const ciphertext = new Uint8Array(base64ToUint8(file.data))
    decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer },
      sourceKey,
      ciphertext.buffer,
    )
  } catch (err) {
    console.error('Import: decrypting failed', err)
    throw new Error('Decryption failed — wrong PIN or password for this file')
  }

  // Parse the decrypted JSON. If decryption "succeeded" but produced
  // garbage (unlikely with AES-GCM's auth tag, but defensive), this catch
  // will report it clearly.
  let vaultData: VaultData
  try {
    const json = new TextDecoder().decode(decryptedBytes)
    vaultData = JSON.parse(json)
  } catch (err) {
    console.error('Import: parsing decrypted data failed', err)
    throw new Error(`Decrypted data is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Get the LOCAL key — we'll re-encrypt everything with this.
  const localKey = getKey()
  if (!localKey) throw new Error('Vault is locked')

  // ── Stage 4: Re-encrypt with local key ─────────────────────────
  //
  // Each entry is re-encrypted individually with its own try/catch so
  // one bad entry doesn't kill the whole import. Fields are validated
  // before encryption — iOS Safari's Web Crypto throws opaque "operation
  // failed" errors when encrypt() receives undefined/null/non-string values.

  console.log('Import: re-encrypting')

  const existingPasswords = await db.passwords.toArray()
  const existingNotes = await db.notes.toArray()
  const existingCategories = await db.noteCategories.toArray()

  // Build Sets of "siteName|username" for password dedup.
  const existingPasswordKeys = new Set<string>()
  for (const p of existingPasswords) {
    const site = await decrypt(p.siteName, localKey)
    const user = await decrypt(p.username, localKey)
    existingPasswordKeys.add(`${site}|${user}`)
  }

  // Build Sets of "title|content" for note dedup.
  const existingNoteKeys = new Set<string>()
  for (const n of existingNotes) {
    const title = await decrypt(n.title, localKey)
    const content = await decrypt(n.content, localKey)
    existingNoteKeys.add(`${title}|${content}`)
  }

  // Build a Map of decrypted category name → existing local ID for category dedup.
  const existingCategoryMap = new Map<string, number>()
  for (const c of existingCategories) {
    const name = await decrypt(c.name, localKey)
    existingCategoryMap.set(name, c.id!)
  }

  // ── Insert categories first (to get new IDs for mapping) ───────

  const categoryIdMap = new Map<number, number>()
  let categoriesAdded = 0

  for (let i = 0; i < (vaultData.noteCategories || []).length; i++) {
    const cat = vaultData.noteCategories[i]
    try {
      const catName = cat.name ?? ''
      console.log(`Import: re-encrypting category ${i} name="${catName}"`)
      const existingId = existingCategoryMap.get(catName)
      if (existingId != null) {
        categoryIdMap.set(cat.id, existingId)
      } else {
        const newId = await db.noteCategories.add({
          name: await encrypt(catName, localKey),
          color: cat.color || 'blue',
          order: cat.order ?? i,
          dateAdded: cat.dateAdded ?? Date.now(),
        })
        categoryIdMap.set(cat.id, newId)
        categoriesAdded++
      }
    } catch (err) {
      console.error(`Import: category ${i} failed (name="${cat.name}")`, err)
      // Skip this category — notes referencing it will become uncategorized.
    }
  }

  // ── Re-encrypt notes (with remapped categoryIds, skipping duplicates) ──

  const newNotes = (vaultData.notes || []).filter(
    (n) => !existingNoteKeys.has(`${n.title}|${n.content}`),
  )

  type EncryptedNote = {
    categoryId?: number; title: string; content: string;
    dateAdded: number; dateModified: number
  }
  const encryptedNotes: EncryptedNote[] = []

  for (let i = 0; i < newNotes.length; i++) {
    const n = newNotes[i]
    try {
      // Validate required fields — coerce undefined/null to empty string.
      // iOS Safari's Web Crypto throws an opaque error if TextEncoder.encode()
      // receives a non-string value (undefined becomes "undefined" on desktop
      // Chrome/Safari but can fail on iOS).
      const title = typeof n.title === 'string' ? n.title : (n.title ?? '')
      const content = typeof n.content === 'string' ? n.content : (n.content ?? '')

      console.log(`Import: re-encrypting note ${i} title="${title.slice(0, 30)}"`)

      encryptedNotes.push({
        categoryId: n.categoryId != null
          ? categoryIdMap.get(n.categoryId)
          : undefined,
        title: await encrypt(String(title), localKey),
        content: await encrypt(String(content), localKey),
        dateAdded: n.dateAdded ?? Date.now(),
        dateModified: n.dateModified ?? Date.now(),
      })
    } catch (err) {
      console.error(`Import: note ${i} failed (title="${n.title}")`, err)
      // Skip this note — better to import partial data than crash entirely.
    }
  }

  // ── Re-encrypt passwords (skipping duplicates) ─────────────────

  const newPasswords = (vaultData.passwords || []).filter(
    (p) => !existingPasswordKeys.has(`${p.siteName}|${p.username}`),
  )

  type EncryptedPassword = {
    siteName: string; siteUrl?: string; username: string;
    password: string; dateAdded: number; dateModified: number
  }
  const encryptedPasswords: EncryptedPassword[] = []

  for (let i = 0; i < newPasswords.length; i++) {
    const p = newPasswords[i]
    try {
      // Validate and coerce all fields to strings. The decrypted vault data
      // SHOULD have string fields, but if the export came from an older version
      // or the JSON structure differs, we handle it gracefully.
      const siteName = typeof p.siteName === 'string' ? p.siteName : String(p.siteName ?? '')
      const username = typeof p.username === 'string' ? p.username : String(p.username ?? '')
      const password = typeof p.password === 'string' ? p.password : String(p.password ?? '')
      const siteUrl = p.siteUrl != null ? (typeof p.siteUrl === 'string' ? p.siteUrl : String(p.siteUrl)) : null

      console.log(`Import: re-encrypting password ${i} site="${siteName}"`)

      // Skip entries where critical fields are completely empty — these are
      // likely corrupt entries that would be useless in the vault.
      if (!siteName && !username && !password) {
        console.warn(`Import: skipping password ${i} — all fields empty`)
        continue
      }

      const entry: EncryptedPassword = {
        siteName: await encrypt(siteName, localKey),
        username: await encrypt(username, localKey),
        password: await encrypt(password, localKey),
        dateAdded: p.dateAdded ?? Date.now(),
        dateModified: p.dateModified ?? Date.now(),
      }

      if (siteUrl) {
        entry.siteUrl = await encrypt(siteUrl, localKey)
      }

      encryptedPasswords.push(entry)
    } catch (err) {
      console.error(`Import: password ${i} failed (site="${p.siteName}")`, err)
      // Skip this password — better to import partial data than crash entirely.
    }
  }

  // ── Stage 5: Write to DB ──────────────────────────────────────

  try {
    console.log('Import: writing to DB')

    if (encryptedNotes.length > 0) {
      await db.notes.bulkAdd(encryptedNotes)
    }

    if (encryptedPasswords.length > 0) {
      await db.passwords.bulkAdd(encryptedPasswords)
    }
  } catch (err) {
    console.error('Import: writing to DB failed', err)
    throw new Error(`Database write failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    passwords: encryptedPasswords.length,
    notes: encryptedNotes.length,
    categories: categoriesAdded,
  }
}
