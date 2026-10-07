import type { Job, JobId } from '@shared/types'
import { getDb } from './index'

interface JobRow {
  id: string
  title: string
  branch: string
  worktree_path: string
  state: string
  detail: string | null
  closed: number
  created_at: number
  updated_at: number
}

export function terminalIdForJob(id: JobId): string {
  return `job:${id}`
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    branch: row.branch,
    worktreePath: row.worktree_path,
    terminalId: terminalIdForJob(row.id),
    state: row.state === 'ready' || row.state === 'failed' ? row.state : 'setting-up',
    detail: row.detail,
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

export function insertJob(job: Job): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO jobs (id, title, branch, worktree_path, state, detail, closed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(job.id, job.title, job.branch, job.worktreePath, job.state, job.detail, job.createdAt, now)
}

export function updateJob(
  id: JobId,
  patch: Partial<Pick<Job, 'title' | 'state' | 'detail'>>
): void {
  const current = getJob(id)
  if (!current) return
  const next = { ...current, ...patch }
  getDb()
    .prepare(`UPDATE jobs SET title = ?, state = ?, detail = ?, updated_at = ? WHERE id = ?`)
    .run(next.title, next.state, next.detail, Date.now(), id)
}
