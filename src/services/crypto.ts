/**
 * Crypto service for Constrictor.
 *
 * Uses the Web Crypto API exclusively (no third-party libraries).
 * Two main responsibilities:
 *   1. Key derivation — turn PIN + master password into an AES-256-GCM key
 *   2. Encrypt/decrypt — protect individual fields before they hit IndexedDB
 *
 * Security properties:
 *   - PBKDF2 with 600,000 iterations makes brute-force expensive
 *   - Random salt (per-device) prevents rainbow table attacks
 *   - AES-256-GCM provides authenticated encryption (tamper detection)
 *   - Random IV per encryption ensures identical plaintexts produce different ciphertexts
 */

// ─── Constants ─────────────────────────────────────────────────────

/**
 * PBKDF2 iteration count. Higher = slower brute-force, but also slower login.
 * 600,000 is the current OWASP recommendation for SHA-256.
 * On a modern iPhone this takes roughly 0.3-0.5 seconds — noticeable but acceptable.
 */
const PBKDF2_ITERATIONS = 600_000

/**
 * Salt length in bytes. 16 bytes (128 bits) is standard and provides
 * more than enough uniqueness — there are 2^128 possible salts.
 */
const SALT_LENGTH = 16

/**
 * IV (initialization vector) length for AES-GCM. The spec recommends 12 bytes
 * (96 bits) for AES-GCM specifically — this is the most efficient length
 * and avoids an extra hashing step that other lengths require.
 */
const IV_LENGTH = 12

/**
 * The string we encrypt during setup and store as the verification token.
 * On login, we try to decrypt it — if decryption succeeds and produces this
 * exact string, we know the PIN + password are correct.
 *
 * Why not just store a hash of the password? Because we need to verify that
 * the derived KEY works, not just the password. This proves the full chain:
 * correct PIN + correct password → correct key → successful decryption.
 */
const VERIFICATION_PLAINTEXT = 'constrictor-verified'

// ─── Salt Generation ───────────────────────────────────────────────

/**
 * Generates a cryptographically random salt.
 *
 * Called once during first-time setup. The salt is stored unencrypted in the
 * `meta` table and reused for every subsequent key derivation. Each device
 * gets its own salt, so even identical credentials produce different keys
 * on different devices.
 *
 * crypto.getRandomValues() uses the OS's cryptographic random number generator
 * (e.g., /dev/urandom on Unix, BCryptGenRandom on Windows).
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

// ─── Key Derivation ────────────────────────────────────────────────

/**
 * Derives an AES-256-GCM encryption key from the user's PIN + master password.
 *
 * The process:
 *   1. Concatenate PIN and password with a separator ("123456:MySecret")
 *   2. Encode the string as UTF-8 bytes
 *   3. Import those bytes as "raw key material" for PBKDF2
 *   4. Run PBKDF2 with SHA-256 for 600,000 iterations using the stored salt
 *   5. Output: a 256-bit AES-GCM CryptoKey
 *
 * The returned CryptoKey is an opaque handle — you can't extract the raw
 * key bytes from it (we don't set `extractable: true`). This is a security
 * feature: even if an attacker gets a memory dump, the key material stays
 * inside the browser's crypto engine.
 *
 * @param pin - The 6-digit PIN as a string (e.g., "123456")
 * @param masterPassword - The master password
 * @param salt - The salt from the meta table (generated during setup)
 * @returns An AES-256-GCM CryptoKey ready for encrypt/decrypt operations
 */
export async function deriveKey(
  pin: string,
  masterPassword: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  // Step 1: Combine PIN and password into a single string.
  // The colon separator ensures "12345" + "6pass" ≠ "123456" + "pass".
  const combined = `${pin}:${masterPassword}`

  // Step 2: Convert the string to bytes. PBKDF2 works on bytes, not strings.
  const encoder = new TextEncoder()
  const keyMaterial = encoder.encode(combined)

  // Step 3: Import the bytes as "raw key material" that PBKDF2 can use.
  // This doesn't do any computation — it just wraps the bytes in a CryptoKey
  // object that the Web Crypto API can work with.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    'PBKDF2',
    false,           // not extractable — we don't need to export this
    ['deriveKey'],   // this key is only used to derive another key
  )

  // Step 4: Run PBKDF2 to derive the actual AES key.
  // This is the slow, intentional part — 600,000 rounds of SHA-256.
  // The salt ensures uniqueness; the iterations ensure brute-force resistance.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },  // output: 256-bit AES-GCM key
    false,           // not extractable
    ['encrypt', 'decrypt'],  // what we can do with this key
  )
}

// ─── Encrypt / Decrypt ─────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * The output format is: base64(IV + ciphertext)
 *
 * We prepend the 12-byte IV to the ciphertext so that decrypt() can
 * extract it later. Every call generates a fresh random IV, which means
 * encrypting "Netflix" twice produces completely different outputs.
 * This is critical — if the same plaintext always produced the same
 * ciphertext, an attacker could identify duplicate passwords.
 *
 * AES-GCM also appends a 16-byte authentication tag to the ciphertext
 * automatically. This tag lets decrypt() verify that the ciphertext
 * hasn't been tampered with.
 *
 * @param plaintext - The string to encrypt (e.g., "Netflix", "hunter2")
 * @param key - The AES-256-GCM key from deriveKey()
 * @returns A base64 string containing IV + ciphertext (safe for IndexedDB storage)
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  // Generate a random 12-byte IV for this specific encryption.
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  // Encode the plaintext string as UTF-8 bytes.
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  // Perform AES-256-GCM encryption.
  // The result includes both the ciphertext and the authentication tag.
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  )

  // Combine IV + ciphertext into a single byte array.
  // Layout: [12 bytes IV][N bytes ciphertext + auth tag]
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  // Encode as base64 for clean string storage in IndexedDB.
  return uint8ToBase64(combined)
}

/**
 * Decrypts a base64-encoded ciphertext string back to plaintext.
 *
 * Reverses the encrypt() process:
 *   1. Decode base64 → bytes
 *   2. Split into IV (first 12 bytes) and ciphertext (rest)
 *   3. AES-GCM decrypt using the IV and key
 *   4. Decode UTF-8 bytes → string
 *
 * If the key is wrong or the ciphertext has been tampered with,
 * AES-GCM will throw an error (the authentication tag won't match).
 * This is how we verify credentials during login — try to decrypt
 * the verification token, and if it throws, the credentials are wrong.
 *
 * @param encryptedBase64 - The base64 string from encrypt()
 * @param key - The same AES-256-GCM key used for encryption
 * @returns The original plaintext string
 * @throws If the key is wrong or data has been tampered with
 */
export async function decrypt(
  encryptedBase64: string,
  key: CryptoKey,
): Promise<string> {
  // Decode from base64 back to bytes.
  const combined = base64ToUint8(encryptedBase64)

  // Split: first 12 bytes are the IV, everything after is ciphertext + auth tag.
  const iv = combined.slice(0, IV_LENGTH)
  const ciphertext = combined.slice(IV_LENGTH)

  // Decrypt. If the key is wrong, this throws a DOMException.
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )

  // Decode the decrypted bytes back into a UTF-8 string.
  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}

// ─── Verification Token ────────────────────────────────────────────

/**
 * Creates the verification token during first-time setup.
 *
 * We encrypt a known string ("constrictor-verified") with the user's
 * newly derived key. The encrypted result is stored in the `meta` table.
 *
 * Later, during login, we derive the key from the entered credentials
 * and try to decrypt this token. If decryption succeeds and produces
 * "constrictor-verified", we know the credentials are correct.
 *
 * This approach means we NEVER store the PIN or password (not even hashed).
 * The only way to "check" credentials is to try using them.
 */
export async function createVerificationToken(key: CryptoKey): Promise<string> {
  return encrypt(VERIFICATION_PLAINTEXT, key)
}

/**
 * Verifies credentials by attempting to decrypt the stored verification token.
 *
 * @param encryptedToken - The verification token from the `meta` table
 * @param key - The key derived from the entered PIN + password
 * @returns true if credentials are correct, false otherwise
 */
export async function verifyCredentials(
  encryptedToken: string,
  key: CryptoKey,
): Promise<boolean> {
  try {
    const decrypted = await decrypt(encryptedToken, key)
    return decrypted === VERIFICATION_PLAINTEXT
  } catch {
    // AES-GCM throws when the key is wrong (authentication tag mismatch).
    // This isn't an error — it's just wrong credentials.
    return false
  }
}

// ─── Base64 Helpers ────────────────────────────────────────────────

/**
 * Converts a Uint8Array to a base64 string.
 *
 * We store encrypted data as base64 strings in IndexedDB because:
 *   1. Strings are simpler to work with than binary blobs
 *   2. They serialize cleanly to JSON (for export/import)
 *   3. Dexie handles string fields more naturally than typed arrays
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Converts a base64 string back to a Uint8Array.
 */
export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
