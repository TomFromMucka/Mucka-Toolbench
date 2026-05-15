import { randomUUID } from 'node:crypto'
import type {
  RoadmapCard,
  RoadmapColumn,
  RoadmapCreateInput,
  RoadmapMoveInput,
  RoadmapUpdateInput
} from '@shared/types'
import { getDb } from './index'

interface CardRow {
  id: string
  title: string
  body: string
  kanban_column: string
  sort_order: number
  tags: string
  created_at: number
  updated_at: number
}

export const COLUMNS: readonly RoadmapColumn[] = [
  'backlog',
  'next',
  'doing',
  'shipped',
  'parked'
] as const

function isValidColumn(c: string): c is RoadmapColumn {
  return (COLUMNS as readonly string[]).includes(c)
}

function rowToCard(row: CardRow): RoadmapCard {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    column: isValidColumn(row.kanban_column) ? row.kanban_column : 'backlog',
    sortOrder: row.sort_order,
    tags: row.tags ? row.tags.split(',').filter((s) => s.length > 0) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function joinTags(tags: string[] | undefined): string {
  if (!tags) return ''
  return tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(',')
}

export function listCards(): RoadmapCard[] {
  const rows = getDb()
    .prepare<[], CardRow>(
      `SELECT * FROM roadmap_cards ORDER BY kanban_column ASC, sort_order ASC, created_at ASC`
    )
    .all()
  return rows.map(rowToCard)
}

export function getCard(id: string): RoadmapCard | null {
  // Exact match first.
  const exact = getDb()
    .prepare<[string], CardRow>(`SELECT * FROM roadmap_cards WHERE id = ?`)
    .get(id)
  if (exact) return rowToCard(exact)
  // Fall back to a unique prefix match so Mucka can pass the short id
  // she sees in list_roadmap output (UUIDs are noisy on screen / in
  // voice transcripts). Only resolves when exactly one card matches.
  const trimmed = id.trim()
  if (trimmed.length < 4) return null
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) return null
  const matches = getDb()
    .prepare<[string], CardRow>(
      `SELECT * FROM roadmap_cards WHERE id LIKE ? || '%' LIMIT 2`
    )
    .all(trimmed)
  if (matches.length === 1) return rowToCard(matches[0])
  return null
}

function nextSortOrder(column: RoadmapColumn): number {
  const row = getDb()
    .prepare<[string], { max: number | null }>(
      `SELECT MAX(sort_order) AS max FROM roadmap_cards WHERE kanban_column = ?`
    )
    .get(column)
  return (row?.max ?? -1) + 1
}

export function createCard(input: RoadmapCreateInput): RoadmapCard {
  const title = input.title.trim()
  if (!title) throw new Error('title must not be empty')
  if (!isValidColumn(input.column)) {
    throw new Error(`column must be one of: ${COLUMNS.join(', ')}`)
  }
  // Accept a client-generated id so attachments uploaded before the
  // first save (during create flow) still resolve.
  const id = input.id && /^[A-Za-z0-9_-]+$/.test(input.id) ? input.id : randomUUID()
  const now = Date.now()
  const sortOrder = input.sortOrder ?? nextSortOrder(input.column)

  // Shift existing rows down when inserting at a specific slot.
  if (input.sortOrder !== undefined) {
    getDb()
      .prepare(
        `UPDATE roadmap_cards
            SET sort_order = sort_order + 1, updated_at = ?
          WHERE kanban_column = ? AND sort_order >= ?`
      )
      .run(now, input.column, sortOrder)
  }

  getDb()
    .prepare(
      `INSERT INTO roadmap_cards (id, title, body, kanban_column, sort_order, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, input.body ?? '', input.column, sortOrder, joinTags(input.tags), now, now)

  const saved = getCard(id)
  if (!saved) throw new Error('card write failed')
  return saved
}

export function updateCard(input: RoadmapUpdateInput): RoadmapCard {
  const current = getCard(input.id)
  if (!current) throw new Error(`unknown card: ${input.id}`)
  const title = input.title === undefined ? current.title : input.title.trim()
  if (title.length === 0) throw new Error('title must not be empty')
  const body = input.body === undefined ? current.body : input.body
  const tags = input.tags === undefined ? current.tags : input.tags
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE roadmap_cards
          SET title = ?, body = ?, tags = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(title, body, joinTags(tags), now, current.id)
  const saved = getCard(current.id)
  if (!saved) throw new Error('card update lost row')
  return saved
}

export function moveCard(input: RoadmapMoveInput): RoadmapCard {
  const current = getCard(input.id)
  if (!current) throw new Error(`unknown card: ${input.id}`)
  if (!isValidColumn(input.column)) {
    throw new Error(`column must be one of: ${COLUMNS.join(', ')}`)
  }
  const now = Date.now()
  const fromColumn = current.column
  const fromOrder = current.sortOrder
  const targetId = current.id

  const tx = getDb().transaction(() => {
    // Close the gap in the source column.
    getDb()
      .prepare(
        `UPDATE roadmap_cards
            SET sort_order = sort_order - 1, updated_at = ?
          WHERE kanban_column = ? AND sort_order > ?`
      )
      .run(now, fromColumn, fromOrder)

    const targetOrder =
      input.sortOrder === undefined ? nextSortOrder(input.column) : input.sortOrder

    // Open a slot in the target column.
    getDb()
      .prepare(
        `UPDATE roadmap_cards
            SET sort_order = sort_order + 1, updated_at = ?
          WHERE kanban_column = ? AND sort_order >= ? AND id != ?`
      )
      .run(now, input.column, targetOrder, targetId)

    // Place the card.
    getDb()
      .prepare(
        `UPDATE roadmap_cards
            SET kanban_column = ?, sort_order = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(input.column, targetOrder, now, targetId)
  })
  tx()

  const saved = getCard(targetId)
  if (!saved) throw new Error('card move lost row')
  return saved
}

export function deleteCard(id: string): boolean {
  const current = getCard(id)
  if (!current) return false
  const tx = getDb().transaction(() => {
    getDb().prepare(`DELETE FROM roadmap_cards WHERE id = ?`).run(current.id)
    // Close the gap in the column.
    getDb()
      .prepare(
        `UPDATE roadmap_cards
            SET sort_order = sort_order - 1, updated_at = ?
          WHERE kanban_column = ? AND sort_order > ?`
      )
      .run(Date.now(), current.column, current.sortOrder)
  })
  tx()
  return true
}

export function countCards(): number {
  const row = getDb()
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM roadmap_cards`)
    .get()
  return row?.n ?? 0
}

/**
 * One-shot import — seeds the kanban from MUCKA.md's existing
 * `## Roadmap` markdown the first time the cockpit boots after this
 * feature lands. Maps `### Next up` → 'next', `### Parked / maybe later`
 * → 'parked', `### Deferred` → 'parked'. Bullets become card titles
 * (the first line, with leading **bold** preserved as title); any
 * trailing wrapped lines become the body.
 */
export function seedFromRoadmapMarkdown(roadmapMd: string): number {
  if (countCards() > 0) return 0
  const cards = parseRoadmapMarkdown(roadmapMd)
  if (cards.length === 0) return 0
  const now = Date.now()
  const insert = getDb().prepare(
    `INSERT INTO roadmap_cards (id, title, body, kanban_column, sort_order, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const tx = getDb().transaction(() => {
    cards.forEach((c, idx) => {
      insert.run(
        randomUUID(),
        c.title,
        c.body,
        c.column,
        idx, // dense per-column ordering handled below
        '',
        now,
        now
      )
    })
    // Re-pack sort_order per column so each column starts at 0.
    for (const col of COLUMNS) {
      const ids = getDb()
        .prepare<[string], { id: string }>(
          `SELECT id FROM roadmap_cards WHERE kanban_column = ? ORDER BY sort_order ASC, created_at ASC`
        )
        .all(col)
        .map((r) => r.id)
      ids.forEach((id, i) => {
        getDb().prepare(`UPDATE roadmap_cards SET sort_order = ? WHERE id = ?`).run(i, id)
      })
    }
  })
  tx()
  return cards.length
}

interface ParsedCard {
  title: string
  body: string
  column: RoadmapColumn
}

function parseRoadmapMarkdown(raw: string): ParsedCard[] {
  const lines = raw.split(/\r?\n/)
  const out: ParsedCard[] = []
  let column: RoadmapColumn | null = null
  let currentTitle: string | null = null
  let currentBody: string[] = []

  const flush = (): void => {
    if (currentTitle !== null && column !== null) {
      out.push({
        title: stripInlineMarkdown(currentTitle.trim()),
        body: stripInlineMarkdown(currentBody.join(' ').trim()),
        column
      })
    }
    currentTitle = null
    currentBody = []
  }

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h3) {
      flush()
      column = mapHeading(h3[1])
      continue
    }
    if (column === null) continue
    const bullet = line.match(/^\s*-\s+(.+)$/)
    if (bullet) {
      flush()
      currentTitle = bullet[1]
      continue
    }
    if (/^\s{2,}\S/.test(line) && currentTitle !== null) {
      currentBody.push(line.trim())
    } else if (line.trim().length === 0) {
      flush()
    }
  }
  flush()
  return out
}

function mapHeading(name: string): RoadmapColumn | null {
  const n = name.trim().toLowerCase()
  if (n.startsWith('next')) return 'next'
  if (n.startsWith('doing') || n.startsWith('in progress')) return 'doing'
  if (n.startsWith('shipped') || n.startsWith('done')) return 'shipped'
  if (n.startsWith('parked') || n.includes('maybe')) return 'parked'
  if (n.startsWith('deferred')) return 'parked'
  if (n.startsWith('backlog')) return 'backlog'
  return null
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}
