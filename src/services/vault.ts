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
    { name: 'AES-GCM', iv },
    key,
    encoded,
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
  // Parse and validate the file.
  const file: ConstrictorFile = JSON.parse(fileContent)

  if (file.version !== 1) {
    throw new Error(`Unsupported file version: ${file.version}`)
  }
  if (!file.salt || !file.iv || !file.data) {
    throw new Error('Invalid file format: missing required fields')
  }

  // Derive the SOURCE key from the provided credentials + embedded salt.
  // This is the key that was used to encrypt the data on the other device.
  const sourceSalt = base64ToUint8(file.salt)
  const sourceKey = await deriveKey(pin, masterPassword, sourceSalt)

  // Decrypt the data blob.
  // If the credentials are wrong, AES-GCM will throw (auth tag mismatch).
  const iv = base64ToUint8(file.iv)
  const ciphertext = base64ToUint8(file.data)

  let decryptedBytes: ArrayBuffer
  try {
    decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      sourceKey,
      ciphertext as BufferSource,
    )
  } catch {
    throw new Error('Decryption failed — wrong PIN or password for this file')
  }

  const json = new TextDecoder().decode(decryptedBytes)
  const vaultData: VaultData = JSON.parse(json)

  // Get the LOCAL key — we'll re-encrypt everything with this.
  const localKey = getKey()
  if (!localKey) throw new Error('Vault is locked')

  // ── Decrypt existing vault entries for duplicate detection ─────
  //
  // To detect duplicates we need to compare plaintext values.
  // We decrypt all existing entries once up front so we can do
  // fast in-memory lookups against the incoming data.

  const existingPasswords = await db.passwords.toArray()
  const existingNotes = await db.notes.toArray()
  const existingCategories = await db.noteCategories.toArray()

  // Build Sets of "siteName|username" for password dedup.
  // We use a pipe delimiter — same idea as the colon in key derivation:
  // it prevents "site" + "name|user" from colliding with "site|name" + "user".
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
  // If an imported category already exists locally, we reuse the local ID
  // instead of creating a duplicate row.
  const existingCategoryMap = new Map<string, number>()
  for (const c of existingCategories) {
    const name = await decrypt(c.name, localKey)
    existingCategoryMap.set(name, c.id!)
  }

  // ── Insert categories first (to get new IDs for mapping) ───────

  // Build a map: source category ID → local ID.
  // If a category with the same name already exists, reuse its ID.
  // Otherwise insert a new row and use the new ID.
  const categoryIdMap = new Map<number, number>()
  let categoriesAdded = 0

  for (const cat of vaultData.noteCategories) {
    const existingId = existingCategoryMap.get(cat.name)
    if (existingId != null) {
      // Category already exists locally — skip insertion, reuse existing ID.
      categoryIdMap.set(cat.id, existingId)
    } else {
      const newId = await db.noteCategories.add({
        name: await encrypt(cat.name, localKey),
        color: cat.color,
        order: cat.order,
        dateAdded: cat.dateAdded,
      })
      categoryIdMap.set(cat.id, newId)
      categoriesAdded++
    }
  }

  // ── Insert notes (with remapped categoryIds, skipping duplicates) ──

  // Filter out notes that already exist (same title AND content).
  const newNotes = vaultData.notes.filter(
    (n) => !existingNoteKeys.has(`${n.title}|${n.content}`),
  )

  const encryptedNotes = await Promise.all(
    newNotes.map(async (n) => ({
      categoryId: n.categoryId != null
        ? categoryIdMap.get(n.categoryId)
        : undefined,
      title: await encrypt(n.title, localKey),
      content: await encrypt(n.content, localKey),
      dateAdded: n.dateAdded,
      dateModified: n.dateModified,
    })),
  )

  if (encryptedNotes.length > 0) {
    await db.notes.bulkAdd(encryptedNotes)
  }

  // ── Insert passwords (skipping duplicates) ─────────────────────

  // Filter out passwords that already exist (same siteName AND username).
  const newPasswords = vaultData.passwords.filter(
    (p) => !existingPasswordKeys.has(`${p.siteName}|${p.username}`),
  )

  const encryptedPasswords = await Promise.all(
    newPasswords.map(async (p) => ({
      siteName: await encrypt(p.siteName, localKey),
      siteUrl: p.siteUrl ? await encrypt(p.siteUrl, localKey) : undefined,
      username: await encrypt(p.username, localKey),
      password: await encrypt(p.password, localKey),
      dateAdded: p.dateAdded,
      dateModified: p.dateModified,
    })),
  )

  if (encryptedPasswords.length > 0) {
    await db.passwords.bulkAdd(encryptedPasswords)
  }

  return {
    passwords: encryptedPasswords.length,
    notes: encryptedNotes.length,
    categories: categoriesAdded,
  }
}
