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
  brief: string | null
  brief_state: string
  brief_error: string | null
  brief_cost: number | null
  scout_dismissed: number
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
    awaitingReply: row.awaiting_reply === 1,
    lastAuthor: row.last_author,
    customerVisible: row.customer_visible === 1,
    brief: row.brief,
    briefState: BRIEF_STATES.find((s) => s === row.brief_state) ?? 'none',
    briefError: row.brief_error,
    briefCost: row.brief_cost,
    scoutDismissed: row.scout_dismissed === 1
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
  | 'awaitingReply'
  | 'lastAuthor'
  | 'customerVisible'
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
        t.awaitingReply ? 1 : 0,
        t.lastAuthor,
        t.customerVisible ? 1 : 0,
        now
      )
      if (!known.has(t.reference)) fresh.push(t.reference)
    }
  })()
  return fresh
}

/**
 * Tickets from a filtered look (which may include closed ones the poll
 * never stores), with any brief the scout has written for them.
 */
export function withBriefs(listed: TicketListing[]): Ticket[] {
  const known = getDb().prepare<[string], TicketRow>(`SELECT * FROM tickets WHERE reference = ?`)
  return listed.map((t) => {
    const row = known.get(t.reference)
    return {
      ...t,
      brief: row?.brief ?? null,
      briefState: BRIEF_STATES.find((s) => s === row?.brief_state) ?? 'none',
      briefError: row?.brief_error ?? null,
      briefCost: row?.brief_cost ?? null,
      scoutDismissed: row?.scout_dismissed === 1
    }
  })
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
      `UPDATE tickets SET brief_state = ?, brief = ?, brief_error = ?, brief_cost = ?, brief_at = ?,
              scout_dismissed = CASE WHEN ? = 'queued' THEN 0 ELSE scout_dismissed END
       WHERE reference = ?`
    )
    .run(
      patch.state,
      patch.brief === undefined ? current.brief : patch.brief,
      patch.error === undefined ? null : patch.error,
      patch.cost === undefined ? current.briefCost : patch.cost,
      Date.now(),
      patch.state,
      reference
    )
}

/** Take a ticket's card off the board's Scouting column. A new scout brings it back. */
export function dismissScout(reference: string): void {
  getDb().prepare(`UPDATE tickets SET scout_dismissed = 1 WHERE reference = ?`).run(reference)
}
