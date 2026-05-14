import type { Memory, MemoryListItem, MemoryType } from '@shared/types'
import { getDb } from './index'

interface MemoryRow {
  topic: string
  type: string
  body: string
  tags: string
  created_at: number
  updated_at: number
}

const VALID_TYPES: readonly MemoryType[] = [
  'profile',
  'preference',
  'project',
  'decision',
  'note'
] as const

function isValidType(t: string): t is MemoryType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    topic: row.topic,
    type: isValidType(row.type) ? row.type : 'note',
    body: row.body,
    tags: row.tags ? row.tags.split(',').filter((s) => s.length > 0) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function previewLine(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (firstLine.length === 0) return '(empty)'
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

/**
 * Cheap index — topic + type + preview + tags, no body. Mucka calls
 * this first to decide which memory to fetch in full.
 */
export function listMemories(opts: {
  type?: MemoryType
  tag?: string
  limit?: number
} = {}): MemoryListItem[] {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50))
  const wheres: string[] = []
  const args: (string | number)[] = []
  if (opts.type) {
    wheres.push('type = ?')
    args.push(opts.type)
  }
  if (opts.tag && opts.tag.trim().length > 0) {
    wheres.push('(tags = ? OR tags LIKE ? OR tags LIKE ? OR tags LIKE ?)')
    const t = opts.tag.trim()
    args.push(t, `${t},%`, `%,${t},%`, `%,${t}`)
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''
  args.push(limit)
  const stmt = getDb().prepare<typeof args, MemoryRow>(
    `SELECT topic, type, body, tags, created_at, updated_at
       FROM memories
       ${where}
       ORDER BY updated_at DESC
       LIMIT ?`
  )
  return stmt.all(...args).map((row) => ({
    topic: row.topic,
    type: isValidType(row.type) ? row.type : 'note',
    preview: previewLine(row.body),
    tags: row.tags ? row.tags.split(',').filter((s) => s.length > 0) : [],
    updatedAt: row.updated_at
  }))
}

export function getMemory(topic: string): Memory | null {
  const row = getDb()
    .prepare<[string], MemoryRow>(
      `SELECT topic, type, body, tags, created_at, updated_at
         FROM memories
         WHERE topic = ?`
    )
    .get(topic.trim())
  return row ? rowToMemory(row) : null
}

/**
 * Upsert by topic. Same topic → overwrites body/type/tags + bumps
 * updated_at. Different topic → fresh row.
 */
export function rememberMemory(input: {
  topic: string
  type: MemoryType
  body: string
  tags?: string[]
}): Memory {
  const topic = input.topic.trim()
  if (!topic) throw new Error('topic must not be empty')
  if (!isValidType(input.type)) {
    throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`)
  }
  const body = input.body.trim()
  if (!body) throw new Error('body must not be empty')
  const tags = (input.tags ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(',')
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO memories (topic, type, body, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic) DO UPDATE SET
           type = excluded.type,
           body = excluded.body,
           tags = excluded.tags,
           updated_at = excluded.updated_at`
    )
    .run(topic, input.type, body, tags, now, now)
  const saved = getMemory(topic)
  if (!saved) throw new Error('memory write failed')
  return saved
}

export function forgetMemory(topic: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM memories WHERE topic = ?`)
    .run(topic.trim())
  return result.changes > 0
}
