/**
 * Biometrics service — WebAuthn integration for Face ID / Touch ID.
 *
 * This module wraps the Web Authentication API (WebAuthn) to provide
 * biometric authentication as an optional first unlock step. It uses
 * the device's built-in "platform authenticator" — meaning Face ID on
 * iPhone or Touch ID on Mac — rather than external security keys.
 *
 * IMPORTANT: We're using WebAuthn in a non-traditional way. Normally,
 * WebAuthn is used for server-side authentication where the server
 * verifies the cryptographic signature. Here, we're using it purely for
 * LOCAL user verification — we just want the device to confirm "yes,
 * this is the device owner" via biometrics. We don't verify the
 * challenge or signature because there's no server. The security value
 * comes from the biometric check itself, not the cryptographic ceremony.
 *
 * Flow:
 *   1. ENROLLMENT (Settings): User enables biometrics → we call
 *      navigator.credentials.create() which triggers Face ID / Touch ID
 *      → store the credential ID in Dexie for future lookups.
 *
 *   2. AUTHENTICATION (Lock screen): On lock screen mount, call
 *      navigator.credentials.get() with the stored credential ID →
 *      Face ID / Touch ID prompt appears → if it passes, advance to PIN.
 *
 * What we store in the database:
 *   - biometricsEnabled: boolean flag
 *   - biometricCredentialId: base64-encoded credential ID (NOT sensitive —
 *     it's just an opaque identifier that tells the authenticator which
 *     credential to use. The private key lives in the device's Secure
 *     Enclave / TPM and is never exposed to JavaScript.)
 */

import { db } from './db'

// ─── Feature Detection ──────────────────────────────────────────────

/**
 * Checks whether the device supports platform biometric authentication.
 *
 * This needs to pass THREE checks:
 *   1. The WebAuthn API exists (window.PublicKeyCredential)
 *   2. The device has a "user-verifying platform authenticator" — meaning
 *      built-in biometric hardware (Face ID sensor, Touch ID fingerprint
 *      reader). This distinguishes from external USB security keys.
 *   3. Implicitly: the page must be served over HTTPS (or localhost).
 *      WebAuthn silently fails on HTTP — PublicKeyCredential won't exist.
 *
 * We cache nothing — this is called infrequently (Settings load, lock
 * screen mount) and the browser's implementation is fast.
 */
export async function canUseBiometrics(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!window.PublicKeyCredential) return false

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    // Some browsers throw instead of returning false. Treat as unsupported.
    return false
  }
}

// ─── Biometric Type Detection ───────────────────────────────────────

/**
 * Returns a human-readable label for the device's biometric type.
 *
 * We check the user agent string to determine the device:
 *   - iPhone/iPad → "Face ID" (all modern iPhones use Face ID; older
 *     ones with Touch ID are rare enough that Face ID is the right label)
 *   - Mac → "Touch ID" (MacBooks with Touch ID in the keyboard)
 *   - Everything else → generic "Biometric Unlock"
 *
 * This is used in the Settings UI to show the appropriate label and icon.
 */
export function getBiometricType(): 'Face ID' | 'Touch ID' | 'Biometric Unlock' {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Face ID'
  if (/Macintosh|Mac OS/.test(ua)) return 'Touch ID'
  return 'Biometric Unlock'
}

// ─── Database Helpers ───────────────────────────────────────────────

/**
 * Checks if biometrics are currently enabled in the database.
 */
export async function isBiometricsEnabled(): Promise<boolean> {
  const entry = await db.meta.get('biometricsEnabled')
  return entry?.value === true
}

/**
 * Retrieves the stored credential ID (base64 string).
 * Returns null if not found.
 */
async function getStoredCredentialId(): Promise<string | null> {
  const entry = await db.meta.get('biometricCredentialId')
  return (entry?.value as string) ?? null
}

// ─── Base64 ↔ ArrayBuffer Utilities ─────────────────────────────────
//
// WebAuthn works with ArrayBuffers, but we need to store credential IDs
// in IndexedDB as strings. Base64 is the standard encoding for this.

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// ─── Enrollment ─────────────────────────────────────────────────────

/**
 * Enrolls the user's biometric credential via WebAuthn.
 *
 * This is called from Settings when the user toggles biometrics ON.
 * It triggers the native Face ID / Touch ID prompt to register a new
 * credential with the device's platform authenticator.
 *
 * Key parameters explained:
 *
 *   rp (Relying Party): Identifies our app to the authenticator.
 *     - id: Must match the current origin's domain. We use location.hostname
 *       so it works on localhost (dev) and the production domain.
 *     - name: Human-readable, shown in the biometric prompt on some platforms.
 *
 *   user: Identifies the user to the authenticator. Since Constrictor is
 *     single-user (no accounts), we use a fixed identifier.
 *     - id: Must be a BufferSource. We use a fixed Uint8Array.
 *     - name/displayName: Shown in the OS credential management UI.
 *
 *   challenge: Normally the server sends a random challenge and verifies
 *     the signed response. Since we have no server and only care about the
 *     biometric verification, we generate a random challenge locally and
 *     never verify it. The challenge still needs to exist because the
 *     WebAuthn spec requires it.
 *
 *   authenticatorSelection:
 *     - authenticatorAttachment: 'platform' means "use the device's built-in
 *       authenticator" (Face ID, Touch ID), NOT an external USB security key.
 *     - userVerification: 'required' means the authenticator MUST verify the
 *       user's identity (biometric or device passcode). Without this, the
 *       credential could be used without any verification.
 *     - residentKey: 'preferred' allows the credential to be stored on the
 *       device as a "discoverable credential" if supported.
 *
 *   pubKeyCredParams: We support both ES256 (ECDSA with P-256, alg -7) and
 *     RS256 (RSASSA-PKCS1-v1_5, alg -257). The authenticator picks whichever
 *     it supports. Since we never verify signatures, the algorithm doesn't
 *     matter — but WebAuthn requires at least one.
 *
 * On success, we store the credential ID and enable the feature flag.
 * On failure (user cancels, hardware error), we throw — the caller
 * (Settings) catches this and shows an error toast.
 */
export async function enrollBiometric(): Promise<void> {
  // Generate a random challenge. We don't verify it — it's just required
  // by the WebAuthn spec to prevent replay attacks in server scenarios.
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  // Fixed user ID — Constrictor is single-user, so this never changes.
  // Using a text encoder to convert a fixed string to bytes.
  const userId = new TextEncoder().encode('constrictor-user')

  const credential = await navigator.credentials.create({
    publicKey: {
      rp: {
        name: 'Constrictor',
        id: location.hostname,
      },
      user: {
        id: userId,
        name: 'Constrictor User',
        displayName: 'Constrictor User',
      },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000, // 60 second timeout for the biometric prompt
    },
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Biometric enrollment was cancelled')
  }

  // Store the credential ID as base64. This is the identifier we'll pass
  // back to the authenticator during verification so it knows which
  // credential (and therefore which private key) to use.
  const credentialId = arrayBufferToBase64(credential.rawId)

  await db.meta.bulkPut([
    { key: 'biometricCredentialId', value: credentialId },
    { key: 'biometricsEnabled', value: true },
  ])
}

// ─── Verification ───────────────────────────────────────────────────

/**
 * Verifies the user's identity via biometrics (Face ID / Touch ID).
 *
 * This is called on the lock screen as the FIRST authentication step.
 * It triggers the native biometric prompt. If the user passes, we return
 * true and the lock screen advances to the PIN stage.
 *
 * How it works:
 *   1. Read the stored credential ID from the database
 *   2. Call navigator.credentials.get() with that credential ID in
 *      the allowCredentials list — this tells the authenticator "use THIS
 *      specific credential" rather than showing a picker
 *   3. The authenticator performs the biometric check (Face ID / Touch ID)
 *   4. If it passes → returns a PublicKeyCredential → we return true
 *   5. If it fails or the user cancels → throws → we return false
 *
 * We don't verify the cryptographic assertion because there's no server
 * to check it against. The value is entirely in the local biometric gate.
 *
 * Edge cases:
 *   - If biometricsEnabled is true but the credential ID is missing or
 *     corrupted → we silently disable biometrics and return false. This
 *     handles the case where the database got into a bad state.
 *   - If the WebAuthn call throws (hardware error, unexpected state) →
 *     we return false so the caller can show a retry button.
 */
export async function verifyBiometric(): Promise<boolean> {
  const credentialIdBase64 = await getStoredCredentialId()

  if (!credentialIdBase64) {
    // Credential ID missing — database is in a bad state.
    // Silently disable biometrics so the user isn't stuck.
    await disableBiometric()
    return false
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const credentialId = base64ToArrayBuffer(credentialIdBase64)

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          type: 'public-key',
          id: credentialId,
          transports: ['internal'], // 'internal' = platform authenticator
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    })

    // If we got a response, the biometric check passed.
    return assertion !== null
  } catch {
    // User cancelled, hardware error, or credential not found.
    // Don't disable biometrics — the user can retry.
    return false
  }
}

// ─── Disable ────────────────────────────────────────────────────────

/**
 * Disables biometric authentication.
 *
 * Removes the stored credential ID and clears the enabled flag.
 * No biometric prompt is needed to disable — the user is already
 * unlocked (authenticated via PIN + password) when they reach Settings.
 *
 * Note: This doesn't "delete" the credential from the device's
 * authenticator — WebAuthn has no API for that. The credential still
 * exists in the Secure Enclave but will never be used because we
 * won't pass its ID to credentials.get() anymore.
 */
export async function disableBiometric(): Promise<void> {
  await db.meta.bulkPut([
    { key: 'biometricsEnabled', value: false },
    { key: 'biometricCredentialId', value: null },
  ])
}
