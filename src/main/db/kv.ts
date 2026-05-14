import { getDb } from './index'

interface KvRow {
  value: string
}

export function getValue(key: string): string | null {
  const row = getDb()
    .prepare<[string], KvRow>(`SELECT value FROM kv WHERE key = ?`)
    .get(key)
  return row?.value ?? null
}

export function setValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, Date.now())
}

/**
 * Append text to an existing kv value, separating with a blank line so the
 * notes blob stays readable. Creates the key if it doesn't exist yet.
 */
export function appendValue(key: string, chunk: string): string {
  const prev = getValue(key) ?? ''
  const separator = prev.length > 0 && !prev.endsWith('\n\n') ? '\n\n' : ''
  const next = prev + separator + chunk
  setValue(key, next)
  return next
}
