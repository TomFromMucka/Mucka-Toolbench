import type { SentryBugNotes } from '@shared/types'
import { getDb } from './index'

/**
 * What's left of the cockpit's own kanban. The roadmap moved to the Mucka
 * app on 15 Oct; its cards were imported there, and `roadmap_cards` stays
 * as the record of the board before the move.
 *
 * Its Issues lane held one card per Sentry bug, with the groundwork notes
 * Mucka wrote, and didn't move: Sentry issues live in Intake. A ticketed
 * issue's bug is that card's id for anything triaged before the move, so
 * Intake shows the card beside the issue.
 */
export function legacyIssueCard(bug: string): SentryBugNotes | null {
  const row = getDb()
    .prepare<[string], { title: string; body: string; updated_at: number }>(
      `SELECT title, body, updated_at FROM roadmap_cards WHERE id = ? AND kanban_column = 'issues'`
    )
    .get(bug)
  return row ? { title: row.title, body: row.body, updatedAt: row.updated_at } : null
}
