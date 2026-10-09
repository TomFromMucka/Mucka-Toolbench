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
  awaiting_reply: number
  last_author: string | null
  customer_visible: number
}

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
    awaitingReply: row.awaiting_reply === 1,
    lastAuthor: row.last_author,
    customerVisible: row.customer_visible === 1
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

/**
 * Bring the table in line with the latest list. A ticket that has left the
 * list is kept but no longer shown.
 */
export function syncTickets(listed: Ticket[]): void {
  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO tickets (reference, subject, status, priority, category, business, raiser,
                          created_at, updated_at, awaiting_reply, last_author, customer_visible,
                          active, first_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(reference) DO UPDATE SET
       subject = excluded.subject, status = excluded.status, priority = excluded.priority,
       category = excluded.category, business = excluded.business, raiser = excluded.raiser,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       awaiting_reply = excluded.awaiting_reply, last_author = excluded.last_author,
       customer_visible = excluded.customer_visible, active = 1`
  )
  const now = Date.now()
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
        t.awaitingReply ? 1 : 0,
        t.lastAuthor,
        t.customerVisible ? 1 : 0,
        now
      )
    }
  })()
}

/**
 * Record a status Tom just set, before the next poll confirms it, so the
 * list never shows a done ticket as still open. Resolved and closed leave
 * the active list at once.
 */
export function setTicketStatus(reference: string, status: string): void {
  const done = status === 'resolved' || status === 'closed'
  getDb()
    .prepare(
      `UPDATE tickets SET status = ?, updated_at = ?, active = CASE WHEN ? THEN 0 ELSE active END
       WHERE reference = ?`
    )
    .run(status, Date.now(), done ? 1 : 0, reference)
}
