import type { WebContents } from 'electron'
import type { AgentId, JobEvent, JobEventInput, JobEventSource, JobEventTone } from '@shared/types'
import { getDb } from '../db/index'

const MAX_ROWS = 500

interface EventRow {
  id: number
  ts: number
  source: string
  kind: string
  message: string
  tone: string
}

function rowToEvent(row: EventRow): JobEvent {
  return {
    id: String(row.id),
    ts: row.ts,
    source: row.source as JobEventSource,
    kind: row.kind,
    message: row.message,
    tone: (row.tone as JobEventTone) ?? 'normal'
  }
}

let webContents: WebContents | null = null

export function bindEventsBroadcaster(wc: WebContents): void {
  webContents = wc
}

export function unbindEventsBroadcaster(): void {
  webContents = null
}

/**
 * Log a job-sheet event and broadcast it to the renderer. Trims the
 * events table when it grows past MAX_ROWS so the table doesn't grow
 * unbounded over months of cockpit use.
 */
export function logEvent(input: JobEventInput): JobEvent {
  const ts = input.ts ?? Date.now()
  const tone: JobEventTone = input.tone ?? 'normal'
  const result = getDb()
    .prepare(
      `INSERT INTO events (ts, source, kind, message, tone) VALUES (?, ?, ?, ?, ?)`
    )
    .run(ts, input.source, input.kind, input.message, tone)
  const id = Number(result.lastInsertRowid)

  // Cap table size — delete the oldest rows beyond MAX_ROWS.
  getDb()
    .prepare(
      `DELETE FROM events WHERE id IN (
         SELECT id FROM events ORDER BY ts DESC LIMIT -1 OFFSET ?
       )`
    )
    .run(MAX_ROWS)

  const event: JobEvent = {
    id: String(id),
    ts,
    source: input.source,
    kind: input.kind,
    message: input.message,
    tone
  }

  if (webContents && !webContents.isDestroyed()) {
    webContents.send('events:append', event)
  }

  return event
}

export function listEvents(limit = 100): JobEvent[] {
  const safeLimit = Math.max(1, Math.min(MAX_ROWS, Math.floor(limit)))
  const rows = getDb()
    .prepare<[number], EventRow>(`SELECT * FROM events ORDER BY ts DESC LIMIT ?`)
    .all(safeLimit)
  return rows.map(rowToEvent)
}

/** Convenience for agent-attributed events. */
export function logAgentEvent(
  agentId: AgentId,
  kind: string,
  message: string,
  tone: JobEventTone = 'normal'
): void {
  logEvent({ source: agentId, kind, message, tone })
}
