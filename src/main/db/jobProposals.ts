import type { JobId, JobProposal } from '@shared/types'
import { getDb } from './index'

interface ProposalRow {
  id: string
  parent_job: string
  parent_title: string | null
  title: string
  brief: string
  created_at: number
}

/** Recorded once: a proposal file read twice (a crash before it was removed) is ignored the second time. */
export function insertProposal(p: {
  id: string
  parentJob: JobId
  title: string
  brief: string
  createdAt: number
}): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO job_proposals (id, parent_job, title, brief, created_at)
       VALUES (@id, @parentJob, @title, @brief, @createdAt)`
    )
    .run(p)
  return res.changes > 0
}

/** Waiting for Tom, oldest first. */
export function listPendingProposals(): JobProposal[] {
  return getDb()
    .prepare<[], ProposalRow>(
      `SELECT p.id, p.parent_job, j.title AS parent_title, p.title, p.brief, p.created_at
         FROM job_proposals p LEFT JOIN jobs j ON j.id = p.parent_job
        WHERE p.state = 'pending'
        ORDER BY p.created_at ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      parentJob: r.parent_job,
      parentTitle: r.parent_title,
      title: r.title,
      brief: r.brief,
      createdAt: r.created_at
    }))
}

export function getPendingProposal(id: string): JobProposal | null {
  return listPendingProposals().find((p) => p.id === id) ?? null
}

export function decideProposal(id: string, state: 'started' | 'dismissed', jobId?: JobId): void {
  getDb()
    .prepare(
      `UPDATE job_proposals SET state = ?, job_id = ?, decided_at = ? WHERE id = ? AND state = 'pending'`
    )
    .run(state, jobId ?? null, Date.now(), id)
}
