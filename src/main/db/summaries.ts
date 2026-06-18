import { getDb } from './index'

/**
 * Condensed, dated summaries of past conversation. The rolling
 * transcript (chat_messages) is capped, so these carry the long-term
 * memory: a summarizer rolls older turns into one of these, and recall
 * searches them alongside recent messages.
 */
export interface ConversationSummary {
  id: number
  /** When the summary was written. */
  ts: number
  /** Earliest message timestamp covered. */
  periodStart: number
  /** Latest message timestamp covered. */
  periodEnd: number
  summary: string
  messageCount: number
}

interface SummaryRow {
  id: number
  ts: number
  period_start: number
  period_end: number
  summary: string
  message_count: number
}

function rowTo(r: SummaryRow): ConversationSummary {
  return {
    id: r.id,
    ts: r.ts,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    summary: r.summary,
    messageCount: r.message_count
  }
}

export function insertSummary(input: {
  periodStart: number
  periodEnd: number
  summary: string
  messageCount: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO conversation_summaries (ts, period_start, period_end, summary, message_count)
         VALUES (?, ?, ?, ?, ?)`
    )
    .run(Date.now(), input.periodStart, input.periodEnd, input.summary, input.messageCount)
}

/** Newest period_end covered by any summary, or 0 if none yet. */
export function lastSummarizedTs(): number {
  const row = getDb()
    .prepare<[], { max: number | null }>(
      `SELECT MAX(period_end) AS max FROM conversation_summaries`
    )
    .get()
  return row?.max ?? 0
}

export function listRecentSummaries(limit = 3): ConversationSummary[] {
  const safe = Math.max(1, Math.min(20, Math.floor(limit)))
  return getDb()
    .prepare<[number], SummaryRow>(
      `SELECT * FROM conversation_summaries ORDER BY ts DESC LIMIT ?`
    )
    .all(safe)
    .map(rowTo)
}

export function searchSummaries(queryStr: string, limit = 5): ConversationSummary[] {
  const q = queryStr.trim()
  if (!q) return []
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'
  const safe = Math.max(1, Math.min(20, Math.floor(limit)))
  return getDb()
    .prepare<[string, number], SummaryRow>(
      `SELECT * FROM conversation_summaries WHERE summary LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`
    )
    .all(like, safe)
    .map(rowTo)
}
