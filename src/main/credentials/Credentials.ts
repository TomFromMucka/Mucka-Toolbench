import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  CredentialCreateInput,
  CredentialSummary,
  CredentialUpdateInput
} from '@shared/credentials'

/**
 * Encrypted-at-rest credentials library — the user's saved site logins
 * that the preview-pane context menu can right-click into any iframe
 * input.
 *
 * Storage layout in `<userData>/credentials.enc.json`:
 *   {
 *     "<id>": { label, createdAt, updatedAt, enc: <base64 safeStorage blob> }
 *   }
 *
 * The `enc` blob decrypts to `{ username, password }` JSON. Labels stay
 * plaintext so menus + Settings can list entries without needing to
 * decrypt the whole library on every render. Each entry is encrypted
 * independently, so deleting or rewriting one doesn't touch the others.
 */

const FILENAME = 'credentials.enc.json'

interface StoredEntry {
  label: string
  createdAt: number
  updatedAt: number
  /** safeStorage.encryptString of `{username, password}` JSON, base64. */
  enc: string
  /** Hosts this login is offered on; absent on entries from before scoping. */
  sites?: string[]
}

function normalizeSites(sites: string[] | undefined): string[] {
  if (!sites) return []
  const out = new Set<string>()
  for (const raw of sites) {
    const host = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')
    if (host) out.add(host)
  }
  return [...out]
}

/** `*.vercel.app` matches any subdomain; a bare host matches exactly. */
function siteMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return pattern === host
}

let cache: Record<string, StoredEntry> | null = null

function storePath(): string {
  return join(app.getPath('userData'), FILENAME)
}

function load(): Record<string, StoredEntry> {
  if (cache) return cache
  try {
    const raw = readFileSync(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cache = parsed as Record<string, StoredEntry>
      return cache
    }
  } catch {
    /* missing or unparseable — start fresh */
  }
  cache = {}
  return cache
}

function save(): void {
  try {
    writeFileSync(storePath(), JSON.stringify(cache ?? {}, null, 2), {
      mode: 0o600
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[credentials] failed to persist store',
      err instanceof Error ? err.message : err
    )
  }
}

function encryptPair(username: string, password: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this system.')
  }
  return safeStorage
    .encryptString(JSON.stringify({ username, password }))
    .toString('base64')
}

function decryptEntry(entry: StoredEntry): { username: string; password: string } | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const json = safeStorage.decryptString(Buffer.from(entry.enc, 'base64'))
    const parsed = JSON.parse(json) as { username?: unknown; password?: unknown }
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
      return null
    }
    return { username: parsed.username, password: parsed.password }
  } catch {
    return null
  }
}

function toSummary(id: string, entry: StoredEntry): CredentialSummary {
  const decrypted = decryptEntry(entry)
  return {
    id,
    label: entry.label,
    username: decrypted?.username ?? '',
    passwordLast4: decrypted?.password ? decrypted.password.slice(-4) : '',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    sites: entry.sites ?? []
  }
}

/**
 * Logins the context menu may offer on `host`: those bound to it, plus
 * any not yet bound to anywhere. A login bound elsewhere is withheld —
 * the whole point is that a lookalike page doesn't get to list the real
 * one.
 */
export function credentialsForHost(host: string): CredentialSummary[] {
  const h = host.trim().toLowerCase()
  return listCredentials().filter(
    (c) => c.sites.length === 0 || (h.length > 0 && c.sites.some((s) => siteMatches(s, h)))
  )
}

/** First use of an unbound login binds it to that host. */
export function recordCredentialSite(id: string, host: string): void {
  const store = load()
  const entry = store[id]
  const [h] = normalizeSites([host])
  if (!entry || !h) return
  if ((entry.sites ?? []).length > 0) return
  entry.sites = [h]
  entry.updatedAt = Date.now()
  save()
}

export function listCredentials(): CredentialSummary[] {
  const store = load()
  return Object.entries(store)
    .map(([id, entry]) => toSummary(id, entry))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function createCredential(input: CredentialCreateInput): CredentialSummary {
  const store = load()
  const id = randomUUID()
  const now = Date.now()
  const entry: StoredEntry = {
    label: input.label.trim() || 'Untitled',
    createdAt: now,
    updatedAt: now,
    enc: encryptPair(input.username, input.password),
    sites: normalizeSites(input.sites)
  }
  store[id] = entry
  save()
  return toSummary(id, entry)
}

export function updateCredential(input: CredentialUpdateInput): CredentialSummary {
  const store = load()
  const existing = store[input.id]
  if (!existing) throw new Error(`No credential with id ${input.id}`)
  const current = decryptEntry(existing) ?? { username: '', password: '' }
  const next: StoredEntry = {
    label: input.label?.trim() || existing.label,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    enc: encryptPair(
      input.username ?? current.username,
      input.password ?? current.password
    ),
    sites: input.sites === undefined ? (existing.sites ?? []) : normalizeSites(input.sites)
  }
  store[input.id] = next
  save()
  return toSummary(input.id, next)
}

export function deleteCredential(id: string): boolean {
  const store = load()
  if (!(id in store)) return false
  delete store[id]
  save()
  return true
}

/**
 * Plaintext readers used only by the main-process context-menu glue
 * when injecting into an iframe. Never IPC-exposed to the renderer.
 */
export function getUsername(id: string): string | null {
  const store = load()
  const entry = store[id]
  if (!entry) return null
  return decryptEntry(entry)?.username ?? null
}

export function getPassword(id: string): string | null {
  const store = load()
  const entry = store[id]
  if (!entry) return null
  return decryptEntry(entry)?.password ?? null
}

export function hasCredential(id: string): boolean {
  return id in load()
}
