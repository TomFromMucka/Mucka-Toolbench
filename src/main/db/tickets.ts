import type { Ticket } from '@shared/types'
import { getDb } from './index'

interface TicketRow {
  reference: string
  subject: string
  status: string
  priority: string | null
  category: string | null
  business: string | null
  raiser: string | null
  created_at: number
  updated_at: number
  brief: string | null
  brief_state: string
  brief_error: string | null
  brief_cost: number | null
}

const BRIEF_STATES: Ticket['briefState'][] = ['none', 'queued', 'running', 'ready', 'failed']

function rowToTicket(row: TicketRow): Ticket {
  return {
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    category: row.category,
    business: row.business,
    raiser: row.raiser,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    brief: row.brief,
    briefState: BRIEF_STATES.find((s) => s === row.brief_state) ?? 'none',
    briefError: row.brief_error,
    briefCost: row.brief_cost
  }
}

/** Open tickets, the most recently touched first. */
export function listActiveTickets(): Ticket[] {
  return getDb()
    .prepare<[], TicketRow>(`SELECT * FROM tickets WHERE active = 1 ORDER BY updated_at DESC`)
    .all()
    .map(rowToTicket)
}

export function getTicket(reference: string): Ticket | null {
  const row = getDb()
    .prepare<[string], TicketRow>(`SELECT * FROM tickets WHERE reference = ?`)
    .get(reference)
  return row ? rowToTicket(row) : null
}

export type TicketListing = Pick<
  Ticket,
  | 'reference'
  | 'subject'
  | 'status'
  | 'priority'
  | 'category'
  | 'business'
  | 'raiser'
  | 'createdAt'
  | 'updatedAt'
>

/**
 * Bring the table in line with the latest list. Returns the references
 * never seen before. A ticket that has left the list is kept (with its
 * brief) but no longer shown.
 */
export function syncTickets(listed: TicketListing[]): string[] {
  const db = getDb()
  const known = new Set(
    db
      .prepare<[], { reference: string }>(`SELECT reference FROM tickets`)
      .all()
      .map((r) => r.reference)
  )
  const upsert = db.prepare(
    `INSERT INTO tickets (reference, subject, status, priority, category, business, raiser,
                          created_at, updated_at, active, first_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(reference) DO UPDATE SET
       subject = excluded.subject, status = excluded.status, priority = excluded.priority,
       category = excluded.category, business = excluded.business, raiser = excluded.raiser,
       created_at = excluded.created_at, updated_at = excluded.updated_at, active = 1`
  )
  const now = Date.now()
  const fresh: string[] = []
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET active = 0`).run()
    for (const t of listed) {
      upsert.run(
        t.reference,
        t.subject,
        t.status,
        t.priority,
        t.category,
        t.business,
        t.raiser,
        t.createdAt,
        t.updatedAt,
        now
      )
      if (!known.has(t.reference)) fresh.push(t.reference)
    }
  })()
  return fresh
}

export function setBrief(
  reference: string,
  patch: {
    state: Ticket['briefState']
    brief?: string | null
    error?: string | null
    cost?: number | null
  }
): void {
  const current = getTicket(reference)
  if (!current) return
  getDb()
    .prepare(
      `UPDATE tickets SET brief_state = ?, brief = ?, brief_error = ?, brief_cost = ?, brief_at = ?
       WHERE reference = ?`
    )
    .run(
      patch.state,
      patch.brief === undefined ? current.brief : patch.brief,
      patch.error === undefined ? null : patch.error,
      patch.cost === undefined ? current.briefCost : patch.cost,
      Date.now(),
      reference
    )
}
