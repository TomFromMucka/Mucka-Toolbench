import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  SECRET_DEFS,
  type SecretId,
  type SecretStatus,
  type SecretTestResult
} from '@shared/secrets'

/**
 * Encrypted-at-rest credential store. Wraps Electron's `safeStorage`
 * API (macOS Keychain / Windows DPAPI / libsecret on Linux) so a stolen
 * but logged-out laptop can't have its `.env` simply cat'd to disk.
 *
 * Layout: a single `secrets.enc.json` in userData. Keys are `SecretId`,
 * values are base64-encoded encrypted blobs. Each value is encrypted
 * independently so removing one doesn't require rewriting the others.
 *
 * Decryption happens once at boot in `initSecrets()`. Plaintext is
 * written into `process.env.<envName>` so all existing call sites
 * (`process.env.GITHUB_TOKEN` etc.) keep working unchanged. `.env`
 * loaded earlier by bootstrap.ts is the default; stored secrets override
 * it where present, but plain `.env`-only setups still function.
 */

const FILENAME = 'secrets.enc.json'

let cachedStore: Record<string, string> = {}
let loaded = false

function storePath(): string {
  return join(app.getPath('userData'), FILENAME)
}

function loadStore(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = readFileSync(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachedStore = parsed as Record<string, string>
    }
  } catch {
    cachedStore = {}
  }
}

function saveStore(): void {
  try {
    writeFileSync(storePath(), JSON.stringify(cachedStore, null, 2), { mode: 0o600 })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[secrets] failed to persist store', err instanceof Error ? err.message : err)
  }
}

function decrypt(id: SecretId): string | null {
  const enc = cachedStore[id]
  if (!enc) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    // Encryption keys may rotate (rare on macOS, more common on Linux
    // when libsecret state changes). Treat as missing rather than
    // crashing — user can re-enter via Settings.
    return null
  }
}

function applyToEnv(id: SecretId, value: string | null): void {
  const def = SECRET_DEFS.find((d) => d.id === id)
  if (!def) return
  if (value === null || value.trim().length === 0) {
    delete process.env[def.envName]
  } else {
    process.env[def.envName] = value
  }
  // electron-updater + the gh CLI both read GH_TOKEN. Mirror it.
  if (id === 'GITHUB_TOKEN') {
    if (value && value.trim().length > 0) {
      process.env.GH_TOKEN = value
    } else if (!process.env.GITHUB_TOKEN) {
      delete process.env.GH_TOKEN
    }
  }
}

/**
 * Apply the encrypted store's contents to `process.env`. Called after
 * `app.whenReady()` (safeStorage isn't available before then) and after
 * bootstrap.ts has already populated env from `.env`. Stored secrets
 * win — they're the explicit "this is what I want" signal.
 */
export function initSecrets(): void {
  loadStore()
  for (const def of SECRET_DEFS) {
    const stored = decrypt(def.id)
    if (stored && stored.trim().length > 0) {
      applyToEnv(def.id, stored)
    }
  }
  // Mirror GITHUB_TOKEN ↔ GH_TOKEN one more time in case the .env path
  // set GH_TOKEN but the store didn't (or vice versa). Belt-and-braces.
  if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) {
    process.env.GH_TOKEN = process.env.GITHUB_TOKEN
  }
  if (!process.env.GITHUB_TOKEN && process.env.GH_TOKEN) {
    process.env.GITHUB_TOKEN = process.env.GH_TOKEN
  }
}

export function setSecret(id: SecretId, value: string): void {
  const def = SECRET_DEFS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown secret: ${id}`)
  loadStore()
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    clearSecret(id)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Encrypted storage is not available on this system. Use .env instead.'
    )
  }
  cachedStore[id] = safeStorage.encryptString(trimmed).toString('base64')
  saveStore()
  applyToEnv(id, trimmed)
}

export function clearSecret(id: SecretId): void {
  loadStore()
  delete cachedStore[id]
  saveStore()
  // Re-apply: if .env still has a value, env wins; otherwise env is cleared.
  const def = SECRET_DEFS.find((d) => d.id === id)
  if (!def) return
  // Don't apply null here directly — .env value (if any) should remain.
  // We just need to drop the store-supplied override. Easiest: re-derive
  // by checking .env. But .env values were ALSO loaded into process.env
  // by bootstrap.ts, then potentially overwritten by initSecrets above.
  // To restore the .env value cleanly we'd need to re-read .env. For now,
  // simplest correct behaviour: blank the env var. User can re-add it
  // via Settings or restart the app to re-source .env.
  delete process.env[def.envName]
  if (id === 'GITHUB_TOKEN') delete process.env.GH_TOKEN
}

export function getSecretStatus(id: SecretId): SecretStatus {
  const def = SECRET_DEFS.find((d) => d.id === id)
  if (!def) return { id, set: false, source: 'none', last4: null }
  loadStore()
  const stored = decrypt(id)
  if (stored && stored.trim().length > 0) {
    return { id, set: true, source: 'store', last4: stored.slice(-4) }
  }
  const envVal = process.env[def.envName]?.trim()
  if (envVal && envVal.length > 0) {
    return { id, set: true, source: 'env', last4: envVal.slice(-4) }
  }
  return { id, set: false, source: 'none', last4: null }
}

export function listSecretStatuses(): SecretStatus[] {
  return SECRET_DEFS.map((d) => getSecretStatus(d.id))
}

/**
 * Hit a lightweight authed endpoint per service to verify the live
 * credential. Uses whatever value is in `process.env` *right now* —
 * caller should `setSecret` first if testing a freshly entered value.
 */
export async function testSecret(id: SecretId): Promise<SecretTestResult> {
  const def = SECRET_DEFS.find((d) => d.id === id)
  if (!def) return { ok: false, reason: 'unknown credential' }
  if (!def.testable) return { ok: false, reason: 'no test endpoint for this credential' }
  const value = process.env[def.envName]?.trim()
  if (!value) return { ok: false, reason: 'not set' }

  try {
    if (id === 'ELEVENLABS_API_KEY') {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': value }
      })
      if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` }
      const data = (await res.json()) as { subscription?: { tier?: string } }
      const tier = data.subscription?.tier
      return { ok: true, detail: tier ? `tier: ${tier}` : 'authenticated' }
    }
    if (id === 'GITHUB_TOKEN') {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${value}`,
          'User-Agent': 'mucka-toolbench',
          Accept: 'application/vnd.github+json'
        }
      })
      if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` }
      const data = (await res.json()) as { login?: string }
      return {
        ok: true,
        detail: data.login ? `authenticated as ${data.login}` : 'authenticated'
      }
    }
    if (id === 'VERCEL_API_TOKEN') {
      const res = await fetch('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${value}` }
      })
      if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` }
      const data = (await res.json()) as { user?: { username?: string } }
      return {
        ok: true,
        detail: data.user?.username
          ? `authenticated as ${data.user.username}`
          : 'authenticated'
      }
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  return { ok: false, reason: 'no test endpoint for this credential' }
}
