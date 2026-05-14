import type { MuckaTextMessage, MuckaTextSegment } from '@shared/types'
import { getDb } from './index'

const MAX_ROWS = 500

interface ChatRow {
  id: number
  ts: number
  role: string
  segments_json: string
}

function parseSegments(json: string): MuckaTextSegment[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return v.filter((s): s is MuckaTextSegment => {
      return (
        s &&
        typeof s === 'object' &&
        typeof (s as MuckaTextSegment).text === 'string' &&
        ((s as MuckaTextSegment).kind === 'text' ||
          (s as MuckaTextSegment).kind === 'tool_call')
      )
    })
  } catch {
    return []
  }
}

function rowToMessage(row: ChatRow): MuckaTextMessage {
  return {
    id: String(row.id),
    ts: row.ts,
    role: row.role === 'user' ? 'user' : 'assistant',
    segments: parseSegments(row.segments_json)
  }
}

export function listChat(): MuckaTextMessage[] {
  const rows = getDb()
    .prepare<[number], ChatRow>(
      `SELECT * FROM chat_messages ORDER BY ts ASC, id ASC LIMIT ?`
    )
    .all(MAX_ROWS)
  return rows.map(rowToMessage)
}

export function appendChat(
  role: 'user' | 'assistant',
  segments: MuckaTextSegment[],
  ts: number = Date.now()
): MuckaTextMessage {
  const json = JSON.stringify(segments)
  const result = getDb()
    .prepare(
      `INSERT INTO chat_messages (ts, role, segments_json) VALUES (?, ?, ?)`
    )
    .run(ts, role, json)

  // Cap table size.
  getDb()
    .prepare(
      `DELETE FROM chat_messages WHERE id IN (
         SELECT id FROM chat_messages ORDER BY ts DESC, id DESC LIMIT -1 OFFSET ?
       )`
    )
    .run(MAX_ROWS)

  return {
    id: String(result.lastInsertRowid),
    ts,
    role,
    segments
  }
}

export function clearChat(): void {
  getDb().exec(`DELETE FROM chat_messages`)
}
