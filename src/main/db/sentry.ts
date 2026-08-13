import type { SentryTriage, SentryVerdict } from '@shared/types'
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
    triageUserCount: row.triage_user_count
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
      `UPDATE sentry_issues
          SET triaged_at = @triagedAt, verdict = @verdict, reason = @reason,
              card_id = @cardId, triage_count = @count, triage_user_count = @userCount
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
