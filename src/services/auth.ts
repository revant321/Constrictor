/**
 * Auth service — manages the encryption key lifecycle.
 *
 * This is the bridge between the UI (setup flow, lock screen) and the
 * crypto/database layers. It handles three operations:
 *
 *   1. Setup — first-time: generate salt, derive key, store verification token
 *   2. Login — returning user: derive key from credentials, verify against token
 *   3. Lock  — wipe the key from memory, making all encrypted data inaccessible
 *
 * The encryption key lives in a module-level variable (`encryptionKey`).
 * This variable is:
 *   - Set during setup() or login()
 *   - Read via getKey() whenever encrypt/decrypt is needed
 *   - Cleared to null by lock()
 *
 * Since JS is single-threaded, there are no race conditions to worry about.
 * The key never touches disk — it only exists in RAM while the app is unlocked.
 */

import { db } from './db'
import {
  generateSalt,
  deriveKey,
  createVerificationToken,
  verifyCredentials,
} from './crypto'

// ─── In-memory encryption key ──────────────────────────────────────

/**
 * The AES-256-GCM key, held in memory only while the app is unlocked.
 *
 * null = locked (no key available → can't decrypt anything)
 * CryptoKey = unlocked (can encrypt/decrypt vault entries)
 *
 * This is a module-level variable, not a class instance or React state,
 * because it needs to be accessible from anywhere in the app (services,
 * hooks, components) without prop-drilling. It's essentially a singleton.
 */
let encryptionKey: CryptoKey | null = null

// ─── Key Access ────────────────────────────────────────────────────

/**
 * Returns the current encryption key, or null if locked.
 *
 * Every encrypt/decrypt operation in the app should call this first.
 * If it returns null, the caller should redirect to the lock screen
 * rather than trying to read encrypted data.
 */
export function getKey(): CryptoKey | null {
  return encryptionKey
}

/**
 * Returns whether the app is currently unlocked (key is in memory).
 */
export function isUnlocked(): boolean {
  return encryptionKey !== null
}

// ─── Setup ─────────────────────────────────────────────────────────

/**
 * First-time setup: creates the vault with the user's chosen credentials.
 *
 * This is called once, ever, when the user completes the setup flow.
 * Here's what happens step by step:
 *
 *   1. Generate a random salt (16 bytes) — this salt is unique to this device
 *      and will be reused for every future login.
 *
 *   2. Derive the AES-256-GCM key from PIN + password + salt using PBKDF2.
 *      This is the slow step (~0.3-0.5s) that makes brute-force hard.
 *
 *   3. Create a verification token — encrypt a known string with the key.
 *      On future logins, we try to decrypt this token to check if the
 *      entered credentials are correct (without ever storing the credentials).
 *
 *   4. Store everything in the `meta` table:
 *      - salt: the PBKDF2 salt (needed to re-derive the key on login)
 *      - verificationToken: encrypted known string (for credential checking)
 *      - lockBehavior: defaults to "close" (lock when app is closed)
 *      - setupComplete: true (so we know not to show setup again)
 *
 *   5. Keep the derived key in memory — the user is now "logged in"
 *      immediately after setup, no need to re-enter credentials.
 *
 * @param pin - The 6-digit PIN the user chose
 * @param masterPassword - The master password the user chose
 */
export async function setup(pin: string, masterPassword: string): Promise<void> {
  // Step 1: Generate a fresh random salt for this device.
  const salt = generateSalt()

  // Step 2: Derive the encryption key. This takes ~0.3-0.5s due to PBKDF2.
  const key = await deriveKey(pin, masterPassword, salt)

  // Step 3: Create the verification token (encrypted known string).
  const verificationToken = await createVerificationToken(key)

  // Step 4: Store everything in the meta table.
  // We use put() instead of add() — put() will overwrite if the key exists,
  // which is safer if setup somehow runs twice (shouldn't happen, but defensive).
  await db.meta.bulkPut([
    { key: 'salt', value: Array.from(salt) },
    // ↑ We store the salt as a plain number array because IndexedDB can be
    //   unreliable with Uint8Array across browsers. Array.from() converts
    //   Uint8Array → number[], and we convert back on read. JSON-safe too.
    { key: 'verificationToken', value: verificationToken },
    { key: 'lockBehavior', value: 'close' },
    { key: 'setupComplete', value: true },
  ])

  // Step 5: Keep the key in memory — user is now unlocked.
  encryptionKey = key
}

// ─── Login ─────────────────────────────────────────────────────────

/**
 * Login: verifies credentials and unlocks the vault.
 *
 * Called from the lock screen when the user enters their PIN + password.
 * The process:
 *
 *   1. Read the salt and verification token from the `meta` table.
 *      These were stored during setup and never change (unless the user
 *      changes their credentials in Settings — Phase 5).
 *
 *   2. Reconstruct the salt as a Uint8Array (it's stored as number[]).
 *
 *   3. Derive the key from the entered credentials + stored salt.
 *      If the user entered wrong credentials, this produces a DIFFERENT
 *      key than the one used during setup — and decryption will fail.
 *
 *   4. Try to decrypt the verification token with the derived key.
 *      - Success → credentials are correct → store key in memory → unlocked
 *      - Failure → wrong credentials → return false, don't store anything
 *
 * @param pin - The PIN entered on the lock screen
 * @param masterPassword - The password entered on the lock screen
 * @returns true if login succeeded, false if credentials are wrong
 */
export async function login(
  pin: string,
  masterPassword: string,
): Promise<boolean> {
  // Step 1: Read salt and verification token from DB.
  const saltEntry = await db.meta.get('salt')
  const tokenEntry = await db.meta.get('verificationToken')

  // If either is missing, the vault is corrupted or setup never completed.
  if (!saltEntry || !tokenEntry) {
    return false
  }

  // Step 2: Convert the stored number[] back to Uint8Array.
  const salt = new Uint8Array(saltEntry.value as number[])
  const verificationToken = tokenEntry.value as string

  // Step 3: Derive the key from the entered credentials.
  const key = await deriveKey(pin, masterPassword, salt)

  // Step 4: Verify by trying to decrypt the token.
  const isValid = await verifyCredentials(verificationToken, key)

  if (isValid) {
    // Correct credentials — store the key and unlock.
    encryptionKey = key
    return true
  }

  // Wrong credentials — don't store anything.
  return false
}

// ─── Lock ──────────────────────────────────────────────────────────

/**
 * Locks the app by wiping the encryption key from memory.
 *
 * After this call, getKey() returns null and all encrypt/decrypt operations
 * will fail. The user must re-authenticate via login() to get a new key.
 *
 * "Wiping" in JavaScript means setting the variable to null. We can't
 * truly zero out the memory like you could in C — the garbage collector
 * will eventually reclaim the old CryptoKey object. However, since the
 * CryptoKey is non-extractable (we set extractable: false during derivation),
 * even a memory dump can't extract the raw key material — it lives inside
 * the browser's crypto engine, not in JavaScript-accessible memory.
 */
export function lock(): void {
  encryptionKey = null
}

// ─── Status Checks ─────────────────────────────────────────────────

/**
 * Checks if first-time setup has been completed.
 *
 * This is called on app startup to decide what screen to show:
 *   - false → show the setup flow (create PIN + password)
 *   - true  → show the lock screen (enter PIN + password)
 *
 * We check by looking for the `setupComplete` flag in the `meta` table.
 */
export async function isSetupComplete(): Promise<boolean> {
  const entry = await db.meta.get('setupComplete')
  return entry?.value === true
}

/**
 * Gets the current lock behavior setting.
 *
 * Two options:
 *   - "close": lock when the app is closed (terminated / swiped away)
 *   - "background": lock when sent to background (home screen / tab switch)
 *
 * The "background" option is more aggressive — it locks whenever you switch
 * to another app or tab. The "close" option only locks when the browser/PWA
 * is fully terminated.
 *
 * This determines which browser events the useAuth hook listens to.
 */
export async function getLockBehavior(): Promise<'close' | 'background'> {
  const entry = await db.meta.get('lockBehavior')
  return (entry?.value as 'close' | 'background') ?? 'close'
}
