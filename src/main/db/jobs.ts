import type { Job, JobId, JobPr, PullRequestState } from '@shared/types'
import { getDb } from './index'

interface JobRow {
  id: string
  title: string
  branch: string
  worktree_path: string
  state: string
  detail: string | null
  needs_install: number
  pr_number: number | null
  pr_url: string | null
  pr_state: string | null
  pr_auto_merge: number
  source: string | null
  brief: string | null
  held: number
  closed: number
  created_at: number
  updated_at: number
}

export function terminalIdForJob(id: JobId): string {
  return `job:${id}`
}

const PR_STATES: PullRequestState[] = ['open', 'closed', 'merged', 'draft']

function prOf(row: JobRow): JobPr | null {
  const state = PR_STATES.find((s) => s === row.pr_state)
  if (row.pr_number === null || !row.pr_url || !state) return null
  return { number: row.pr_number, url: row.pr_url, state, autoMerge: row.pr_auto_merge === 1 }
}

const JOB_STATES: Job['state'][] = ['setting-up', 'ready', 'failed', 'finished']

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    branch: row.branch,
    worktreePath: row.worktree_path,
    terminalId: terminalIdForJob(row.id),
    state: JOB_STATES.find((s) => s === row.state) ?? 'setting-up',
    detail: row.detail,
    needsInstall: row.needs_install === 1,
    pr: prOf(row),
    source: row.source,
    held: row.held === 1,
    createdAt: row.created_at
  }
}

export function listOpenJobs(): Job[] {
  return getDb()
    .prepare<[], JobRow>(`SELECT * FROM jobs WHERE closed = 0 ORDER BY created_at ASC`)
    .all()
    .map(rowToJob)
}

export function getJob(id: JobId): Job | null {
  const row = getDb().prepare<[string], JobRow>(`SELECT * FROM jobs WHERE id = ?`).get(id)
  return row ? rowToJob(row) : null
}

export function insertJob(job: Job, brief: string | null): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO jobs (id, title, branch, worktree_path, state, detail, source, brief, closed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      job.id,
      job.title,
      job.branch,
      job.worktreePath,
      job.state,
      job.detail,
      job.source,
      brief,
      job.createdAt,
      now
    )
}

/** The opening message a job from Intake starts its Claude with. */
export function getJobBrief(id: JobId): string | null {
  const row = getDb()
    .prepare<[string], { brief: string | null }>(`SELECT brief FROM jobs WHERE id = ?`)
    .get(id)
  return row?.brief ?? null
}

export function updateJob(
  id: JobId,
  patch: Partial<Pick<Job, 'title' | 'state' | 'detail' | 'needsInstall' | 'pr'>>
): void {
  const current = getJob(id)
  if (!current) return
  const next = { ...current, ...patch }
  getDb()
    .prepare(
      `UPDATE jobs SET title = ?, state = ?, detail = ?, needs_install = ?,
         pr_number = ?, pr_url = ?, pr_state = ?, pr_auto_merge = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      next.title,
      next.state,
      next.detail,
      next.needsInstall ? 1 : 0,
      next.pr?.number ?? null,
      next.pr?.url ?? null,
      next.pr?.state ?? null,
      next.pr?.autoMerge ? 1 : 0,
      Date.now(),
      id
    )
}

export function setJobHeld(id: JobId, held: boolean): void {
  getDb()
    .prepare(`UPDATE jobs SET held = ?, updated_at = ? WHERE id = ?`)
    .run(held ? 1 : 0, Date.now(), id)
}

/** Take a job off the board. The row stays, for history and metrics. */
export function closeJob(id: JobId): void {
  getDb().prepare(`UPDATE jobs SET closed = 1, updated_at = ? WHERE id = ?`).run(Date.now(), id)
}
