import type {
  SentryCardSibling,
  SentryStatusChange,
  SentryTriage,
  SentryVerdict
} from '@shared/types'
import { getDb } from './index'

interface TriageRow {
  issue_id: string
  short_id: string
  title: string
  project: string
  permalink: string
  first_seen: number
  seen_at: number
  triaged_at: number | null
  verdict: string | null
  reason: string | null
  card_id: string | null
  triage_count: number
  triage_user_count: number
  last_status: string
  last_substatus: string | null
  status_changed_at: number | null
  pending_from_status: string | null
  status_checked_at: number | null
}

function rowToTriage(row: TriageRow): SentryTriage {
  return {
    issueId: row.issue_id,
    shortId: row.short_id,
    title: row.title,
    project: row.project,
    permalink: row.permalink,
    firstSeen: row.first_seen,
    seenAt: row.seen_at,
    triagedAt: row.triaged_at,
    verdict: isVerdict(row.verdict) ? row.verdict : null,
    reason: row.reason,
    cardId: row.card_id,
    triageCount: row.triage_count,
    triageUserCount: row.triage_user_count,
    statusCheckedAt: row.status_checked_at
  }
}

function isVerdict(v: string | null): v is SentryVerdict {
  return v === 'ticket' || v === 'noise' || v === 'watch'
}

/** Issue ids the cockpit has already seen. The dedupe key for the poller. */
export function knownIssueIds(): Set<string> {
  const rows = getDb()
    .prepare<[], { issue_id: string }>(`SELECT issue_id FROM sentry_issues`)
    .all()
  return new Set(rows.map((r) => r.issue_id))
}

/**
 * Record an issue the poller hasn't seen before. No-op if it's already
 * there, so a re-poll can never queue the same issue for triage twice.
 * Returns true when the row was actually new.
 */
export function recordSeen(input: {
  issueId: string
  shortId: string
  title: string
  project: string
  permalink: string
  firstSeen: number
}): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO sentry_issues
         (issue_id, short_id, title, project, permalink, first_seen, seen_at)
       VALUES (@issueId, @shortId, @title, @project, @permalink, @firstSeen, @seenAt)`
    )
    .run({ ...input, seenAt: Date.now() })
  return res.changes > 0
}

export function recordTriage(input: {
  issueId: string
  verdict: SentryVerdict
  reason: string
  cardId?: string | null
  /** Event + user counts as they stood when the call was made. */
  count?: number
  userCount?: number
}): void {
  getDb()
    .prepare(
      // The verdict is ruled on an issue that just came off the unresolved
      // poll, so "unresolved, observed now" is a true baseline. Stamping it
      // here keeps a ticket out of the watch pass's silent first read, so a
      // fix that lands minutes after the card is written still reports.
      `UPDATE sentry_issues
          SET triaged_at = @triagedAt, verdict = @verdict, reason = @reason,
              card_id = @cardId, triage_count = @count, triage_user_count = @userCount,
              last_status = 'unresolved', last_substatus = NULL,
              status_checked_at = @triagedAt
        WHERE issue_id = @issueId`
    )
    .run({
      issueId: input.issueId,
      triagedAt: Date.now(),
      verdict: input.verdict,
      reason: input.reason,
      cardId: input.cardId ?? null,
      count: input.count ?? 0,
      userCount: input.userCount ?? 0
    })
}

/**
 * Put a previously-triaged issue back in the queue. `verdict` and `reason`
 * are deliberately left in place — they're the "you said watch because X"
 * context the re-triage turn is built from.
 */
export function markForRetriage(issueId: string): void {
  getDb()
    .prepare(`UPDATE sentry_issues SET triaged_at = NULL WHERE issue_id = ?`)
    .run(issueId)
}

/** Issues seen but not yet triaged — what the triage queue drains. */
export function listUntriaged(): SentryTriage[] {
  const rows = getDb()
    .prepare<[], TriageRow>(
      `SELECT * FROM sentry_issues WHERE triaged_at IS NULL ORDER BY first_seen ASC`
    )
    .all()
  return rows.map(rowToTriage)
}

export function listTriaged(limit = 50): SentryTriage[] {
  const rows = getDb()
    .prepare<[number], TriageRow>(
      `SELECT * FROM sentry_issues
        WHERE triaged_at IS NOT NULL
        ORDER BY triaged_at DESC
        LIMIT ?`
    )
    .all(limit)
  return rows.map(rowToTriage)
}

export function getTriage(issueId: string): SentryTriage | null {
  const row = getDb()
    .prepare<[string], TriageRow>(`SELECT * FROM sentry_issues WHERE issue_id = ?`)
    .get(issueId)
  return row ? rowToTriage(row) : null
}

/**
 * Ticketed issues the poller keeps an eye on after the verdict. A shipped
 * card stays on the list on purpose — a regression months later is exactly
 * the move worth waking her for, and dropping it once shipped would make
 * that invisible.
 *
 * Least-recently-checked first (never-checked first of all), because the
 * caller can only afford to ask Sentry about a slice of these per tick and
 * that ordering is what makes the slice a fair sweep rather than the same
 * dozen rows forever.
 */
export function listWatchedTickets(): SentryTriage[] {
  const rows = getDb()
    .prepare<[], TriageRow>(
      `SELECT * FROM sentry_issues
        WHERE card_id IS NOT NULL AND verdict = 'ticket'
        ORDER BY status_checked_at ASC, triaged_at DESC`
    )
    .all()
  return rows.map(rowToTriage)
}

/** Stamp the round-robin cursor, whether or not the status moved. */
export function markStatusChecked(issueId: string): void {
  getDb()
    .prepare(`UPDATE sentry_issues SET status_checked_at = ? WHERE issue_id = ?`)
    .run(Date.now(), issueId)
}

/**
 * The other issues sharing a card, and where each stands. Several of the
 * cockpit's cards cover a cluster of related errors, so "this one issue is
 * resolved" is not the same as "this card is done" — she needs to see the
 * rest before moving it.
 */
function cardSiblings(cardId: string | null, issueId: string): SentryCardSibling[] {
  if (!cardId) return []
  const rows = getDb()
    .prepare<[string, string], { short_id: string; last_status: string }>(
      `SELECT short_id, last_status FROM sentry_issues
        WHERE card_id = ? AND issue_id != ?
        ORDER BY short_id ASC`
    )
    .all(cardId, issueId)
  return rows.map((r) => ({ shortId: r.short_id, status: r.last_status }))
}

/**
 * Record where a watched issue stands now. Returns the change when the
 * status actually moved, so the caller reports an edge rather than the
 * same state every five minutes. `pending_from_status` is only stamped on
 * the first undelivered move — a second one before she's been told keeps
 * the original starting point.
 *
 * `silent` writes the status down without queueing it for the PM, and
 * returns null. That's the first read of an issue the watch pass has
 * never seen: the row says "unresolved" only because that's the column
 * default, so treating the true status as a *change* would hand her every
 * already-fixed ticket at once.
 */
export function recordStatus(input: {
  issueId: string
  status: string
  substatus: string | null
  silent?: boolean
}): SentryStatusChange | null {
  const db = getDb()
  const row = db
    .prepare<[string], TriageRow>(`SELECT * FROM sentry_issues WHERE issue_id = ?`)
    .get(input.issueId)
  if (!row) return null
  if (row.last_status === input.status && row.last_substatus === input.substatus) {
    return null
  }

  const changedAt = Date.now()
  const from = input.silent ? null : (row.pending_from_status ?? row.last_status)
  db.prepare(
    `UPDATE sentry_issues
        SET last_status = @status, last_substatus = @substatus,
            status_changed_at = @changedAt, pending_from_status = @from
      WHERE issue_id = @issueId`
  ).run({
    issueId: input.issueId,
    status: input.status,
    substatus: input.substatus,
    changedAt,
    from
  })
  if (input.silent) return null

  return {
    issueId: row.issue_id,
    shortId: row.short_id,
    title: row.title,
    project: row.project,
    permalink: row.permalink,
    cardId: row.card_id,
    cardSiblings: cardSiblings(row.card_id, row.issue_id),
    from: from ?? row.last_status,
    to: input.status,
    substatus: input.substatus,
    changedAt
  }
}

/**
 * Status moves the PM hasn't been handed yet. The live IPC event can be
 * missed — the poller's first tick can beat the renderer's subscription,
 * and the window is shut overnight — so delivery is driven off this rather
 * than off the event alone.
 */
export function listPendingStatusChanges(): SentryStatusChange[] {
  const rows = getDb()
    .prepare<[], TriageRow>(
      `SELECT * FROM sentry_issues
        WHERE pending_from_status IS NOT NULL
        ORDER BY status_changed_at ASC`
    )
    .all()
  return rows.map((row) => ({
    issueId: row.issue_id,
    shortId: row.short_id,
    title: row.title,
    project: row.project,
    permalink: row.permalink,
    cardId: row.card_id,
    cardSiblings: cardSiblings(row.card_id, row.issue_id),
    from: row.pending_from_status ?? row.last_status,
    to: row.last_status,
    substatus: row.last_substatus,
    changedAt: row.status_changed_at ?? row.seen_at
  }))
}

/** Mucka has been told; stop re-queueing this one. */
export function ackStatusChange(issueId: string): void {
  getDb()
    .prepare(`UPDATE sentry_issues SET pending_from_status = NULL WHERE issue_id = ?`)
    .run(issueId)
}
