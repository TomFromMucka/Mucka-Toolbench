import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { JobProposal } from '@shared/types'
import { getJob } from '../db/jobs'
import { insertProposal, listPendingProposals } from '../db/jobProposals'
import { logEvent } from '../events/Events'

/** A proposal is a deliberate act by a Claude mid-job; a few seconds' wait is fine. */
const POLL_MS = 3000

const PROPOSALS_DIR = join(homedir(), '.claude', 'mucka-jobs', 'proposals')
const ID = /^p-\d+-\d+$/

/**
 * Picks up the jobs a job's Claude proposes with `~/.claude/mucka-job.sh
 * propose`, and records them for Intake. Nothing here starts a job: a
 * spin-off waits for Tom, so one Claude can't set off a chain of them.
 */
export class SpinoffWatcher {
  private readonly emit: (proposals: JobProposal[]) => void
  private timer: NodeJS.Timeout | null = null

  constructor(emit: (proposals: JobProposal[]) => void) {
    this.emit = emit
  }

  start(): void {
    this.scan()
    this.timer = setInterval(() => this.scan(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  publish(): void {
    this.emit(listPendingProposals())
  }

  private scan(): void {
    if (!existsSync(PROPOSALS_DIR)) return
    let added = false
    for (const name of readdirSync(PROPOSALS_DIR)) {
      if (!name.endsWith('.json')) continue
      const path = join(PROPOSALS_DIR, name)
      try {
        added = this.take(readFileSync(path, 'utf8')) || added
      } catch {
        // Unreadable or malformed: drop it rather than retry it forever.
      }
      rmSync(path, { force: true })
    }
    if (added) this.publish()
  }

  private take(raw: string): boolean {
    const p: unknown = JSON.parse(raw)
    if (typeof p !== 'object' || p === null) return false
    const id = 'id' in p && typeof p.id === 'string' ? p.id : ''
    const parent = 'parent' in p && typeof p.parent === 'string' ? p.parent : ''
    const title = 'title' in p && typeof p.title === 'string' ? p.title.trim().slice(0, 120) : ''
    const brief = 'brief' in p && typeof p.brief === 'string' ? p.brief.slice(0, 20_000) : ''
    const at = 'at' in p && typeof p.at === 'number' ? p.at : Date.now()
    const job = getJob(parent)
    if (!ID.test(id) || !job || !title || !brief.trim()) return false
    if (!insertProposal({ id, parentJob: job.id, title, brief, createdAt: at })) return false
    logEvent({
      source: 'system',
      kind: 'jobs.spinoff_proposed',
      message: `"${job.title.slice(0, 60)}" proposed a new job: ${title}. It's in Intake, under spin-offs.`,
      tone: 'attention'
    })
    return true
  }
}
