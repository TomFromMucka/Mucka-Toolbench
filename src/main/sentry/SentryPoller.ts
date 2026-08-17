import type { WebContents } from 'electron'
import type {
  SentryEscalation,
  SentryIssue,
  SentryNewIssueEvent,
  SentryTriage
} from '@shared/types'
import { getStatus, listIssues } from './Sentry'
import { getTriage, knownIssueIds, markForRetriage, recordSeen } from '../db/sentry'
import { logEvent } from '../events/Events'

/**
 * Five minutes. Sentry is not a firehose here — the org averages a couple
 * of issues a quarter — so this is about noticing within a coffee break,
 * not keeping up with volume.
 */
const POLL_INTERVAL_MS = 5 * 60_000

/**
 * How far back the first poll of a boot looks. Deliberately short: on a
 * fresh install the sqlite table is empty, so a wide window would hand
 * Mucka months of history to triage in one go. Anything older than this
 * that still matters will still be there to find on demand.
 */
const FIRST_RUN_PERIOD = '24h'
const STEADY_PERIOD = '14d'

/**
 * What counts as a watched issue getting worse. Either anyone new being
 * affected — going from "nobody noticed" to "someone did" is the whole
 * signal — or the event count growing by both a multiple and an absolute
 * margin, so a 2-event issue ticking to 4 doesn't drag her back.
 */
const ESCALATION_COUNT_FACTOR = 5
const ESCALATION_COUNT_MARGIN = 20

interface SentryPollerDeps {
  webContents: WebContents
  /** Called once per genuinely new issue, after it's been recorded. */
  onNewIssue?: (issue: SentryIssue) => void
}

function hasEscalated(issue: SentryIssue, prior: SentryTriage): boolean {
  if (issue.userCount > prior.triageUserCount) return true
  return (
    issue.count >= prior.triageCount * ESCALATION_COUNT_FACTOR &&
    issue.count - prior.triageCount >= ESCALATION_COUNT_MARGIN
  )
}

function toneFor(issue: SentryIssue): 'bad' | 'attention' | 'normal' {
  if (issue.userCount > 0 || issue.priority === 'high') return 'bad'
  if (issue.level === 'error' || issue.level === 'fatal') return 'attention'
  return 'normal'
}

/**
 * Polls the org's unresolved issues and reports ones the cockpit has never
 * seen. Dedupe is by Sentry issue id in sqlite, so restarts, HMR reloads
 * and overlapping ticks can't re-report or re-triage the same issue.
 */
export class SentryPoller {
  private timer: NodeJS.Timeout | null = null
  private readonly webContents: WebContents
  private readonly onNewIssue: ((issue: SentryIssue) => void) | undefined
  private ticking = false
  private hasPolled = false
  private lastError: string | null = null
  private cache: SentryIssue[] = []

  constructor(deps: SentryPollerDeps) {
    this.webContents = deps.webContents
    this.onNewIssue = deps.onNewIssue
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Latest known unresolved issues, newest first. Empty until first poll. */
  getAll(): SentryIssue[] {
    return this.cache
  }

  getError(): string | null {
    return this.lastError
  }

  /**
   * Enough to tell "nothing is wrong" from "we don't know yet". An empty
   * issue list is ambiguous on its own — never polled, poll failed, and
   * genuinely clean all look identical, and reporting the last two as
   * "clean" is worse than saying nothing.
   */
  getHealth(): { hasPolled: boolean; lastError: string | null; count: number } {
    return {
      hasPolled: this.hasPolled,
      lastError: this.lastError,
      count: this.cache.length
    }
  }

  async refresh(): Promise<SentryIssue[]> {
    await this.tick()
    return this.cache
  }

  private async tick(): Promise<void> {
    if (this.webContents.isDestroyed()) return
    if (getStatus().kind !== 'ok') return
    // Ticks overlap when a poll runs long; a second pass would read the
    // same issues before the first has written them to sqlite and report
    // every one of them twice.
    if (this.ticking) return
    this.ticking = true

    try {
      const issues = await listIssues({
        query: 'is:unresolved',
        statsPeriod: this.hasPolled ? STEADY_PERIOD : FIRST_RUN_PERIOD
      })
      this.cache = issues
      this.lastError = null

      const known = knownIssueIds()
      for (const issue of issues) {
        if (known.has(issue.id)) {
          this.checkEscalation(issue)
          continue
        }
        const isNew = recordSeen({
          issueId: issue.id,
          shortId: issue.shortId,
          title: issue.title,
          project: issue.project,
          permalink: issue.permalink,
          firstSeen: issue.firstSeen
        })
        if (!isNew) continue

        logEvent({
          source: 'system',
          kind: 'sentry.new_issue',
          message: `Sentry — ${issue.shortId} ${issue.title.slice(0, 90)} (${issue.project}${
            issue.userCount > 0 ? `, ${issue.userCount} user${issue.userCount === 1 ? '' : 's'}` : ''
          })`,
          tone: toneFor(issue)
        })
        this.broadcast(issue)
        this.onNewIssue?.(issue)
      }
      this.hasPolled = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Log the first failure of a run only — a bad token would otherwise
      // write a job-sheet line every five minutes, forever.
      if (this.lastError !== message) {
        this.lastError = message
        logEvent({
          source: 'system',
          kind: 'sentry.error',
          message: `Sentry poll failed: ${message.slice(0, 160)}`,
          tone: 'bad'
        })
      }
    } finally {
      this.ticking = false
    }
  }

  /**
   * A `watch` verdict would otherwise be a dead end — she rules "not yet"
   * and the issue never comes back, however bad it gets. So re-queue a
   * watched issue once it crosses the escalation bar. Tickets are already
   * actioned and noise is archived out of the unresolved list, so neither
   * reaches here.
   */
  private checkEscalation(issue: SentryIssue): void {
    const prior = getTriage(issue.id)
    if (!prior || prior.triagedAt === null) return
    if (prior.verdict !== 'watch') return
    if (!hasEscalated(issue, prior)) return

    markForRetriage(issue.id)
    logEvent({
      source: 'system',
      kind: 'sentry.escalated',
      message:
        `Sentry — ${issue.shortId} escalated since you watched it: ` +
        `${prior.triageCount} → ${issue.count} events, ` +
        `${prior.triageUserCount} → ${issue.userCount} users`,
      tone: issue.userCount > 0 ? 'bad' : 'attention'
    })
    const escalation: SentryEscalation = {
      previousVerdict: prior.verdict,
      previousReason: prior.reason,
      previousCount: prior.triageCount,
      previousUserCount: prior.triageUserCount
    }
    this.broadcast(issue, escalation)
    this.onNewIssue?.(issue)
  }

  private broadcast(issue: SentryIssue, escalation?: SentryEscalation): void {
    if (this.webContents.isDestroyed()) return
    const event: SentryNewIssueEvent = escalation ? { issue, escalation } : { issue }
    this.webContents.send('sentry:new-issue', event)
  }
}
