import type { Notice, NoticeColour } from '@shared/types'
import { getDb } from './index'

interface NoticeRow {
  id: string
  title: string
  body: string
  colour: string
  pinned: number
  created_at: number
}

const ALLOWED_COLOURS: NoticeColour[] = ['cream', 'yellow', 'pink', 'blue']

function rowToNotice(row: NoticeRow): Notice {
  const colour: NoticeColour = (ALLOWED_COLOURS as string[]).includes(row.colour)
    ? (row.colour as NoticeColour)
    : 'cream'
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    colour,
    pinned: row.pinned === 1,
    createdAt: row.created_at
  }
}

export function listNotices(): Notice[] {
  const rows = getDb()
    .prepare<[], NoticeRow>(
      `SELECT * FROM notices ORDER BY pinned DESC, created_at DESC`
    )
    .all()
  return rows.map(rowToNotice)
}

export function addNotice(
  title: string,
  body: string,
  colour: NoticeColour = 'cream',
  pinned = false
): Notice {
  const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const createdAt = Date.now()
  getDb()
    .prepare(
      `INSERT INTO notices (id, title, body, colour, pinned, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, body, colour, pinned ? 1 : 0, createdAt)
  return { id, title, body, colour, pinned, createdAt }
}

export function removeNotice(id: string): boolean {
  const info = getDb().prepare(`DELETE FROM notices WHERE id = ?`).run(id)
  return info.changes > 0
}

export function removeNoticeByTitle(title: string): number {
  const info = getDb().prepare(`DELETE FROM notices WHERE title = ?`).run(title)
  return info.changes
}
