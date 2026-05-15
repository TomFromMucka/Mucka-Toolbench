import type { AgentConfig, AgentId } from '@shared/types'
import { getDb } from './index'

interface AgentRow {
  id: AgentId
  display_name: string
  branch: string
  worktree_path: string
  command: string
  args: string
  sort_order: number
  updated_at: number
  needs_attention: number
  attention_reason: string | null
  preview_url: string | null
  vercel_project_id: string | null
  running: number
}

function rowToConfig(row: AgentRow): AgentConfig {
  let parsedArgs: string[] = []
  try {
    const v = JSON.parse(row.args)
    if (Array.isArray(v)) parsedArgs = v.filter((s): s is string => typeof s === 'string')
  } catch {
    parsedArgs = []
  }
  return {
    id: row.id,
    displayName: row.display_name,
    branch: row.branch,
    worktreePath: row.worktree_path,
    command: row.command,
    args: parsedArgs,
    needsAttention: row.needs_attention === 1,
    attentionReason: row.attention_reason ?? null,
    previewUrl: row.preview_url ?? null,
    vercelProjectId: row.vercel_project_id ?? null,
    running: row.running === 1
  }
}

export function listAgents(): AgentConfig[] {
  const rows = getDb()
    .prepare<[], AgentRow>(`SELECT * FROM agents ORDER BY sort_order ASC`)
    .all()
  return rows.map(rowToConfig)
}

export function getAgent(id: AgentId): AgentConfig | undefined {
  const row = getDb()
    .prepare<[AgentId], AgentRow>(`SELECT * FROM agents WHERE id = ?`)
    .get(id)
  return row ? rowToConfig(row) : undefined
}

export function upsertAgent(agent: AgentConfig, sortOrder: number): void {
  getDb()
    .prepare(
      `INSERT INTO agents (id, display_name, branch, worktree_path, command, args, sort_order, updated_at, needs_attention, attention_reason, preview_url, vercel_project_id, running)
       VALUES (@id, @displayName, @branch, @worktreePath, @command, @args, @sort_order, @updated_at, @needs_attention, @attention_reason, @preview_url, @vercel_project_id, @running)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         branch = excluded.branch,
         worktree_path = excluded.worktree_path,
         command = excluded.command,
         args = excluded.args,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         needs_attention = excluded.needs_attention,
         attention_reason = excluded.attention_reason,
         preview_url = excluded.preview_url,
         vercel_project_id = excluded.vercel_project_id,
         running = excluded.running`
    )
    .run({
      id: agent.id,
      displayName: agent.displayName,
      branch: agent.branch,
      worktreePath: agent.worktreePath,
      command: agent.command,
      args: JSON.stringify(agent.args),
      sort_order: sortOrder,
      updated_at: Date.now(),
      needs_attention: agent.needsAttention ? 1 : 0,
      attention_reason: agent.attentionReason ?? null,
      preview_url: agent.previewUrl ?? null,
      vercel_project_id: agent.vercelProjectId ?? null,
      running: agent.running ? 1 : 0
    })
}

export function seedIfEmpty(defaults: AgentConfig[]): void {
  const row = getDb()
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM agents`)
    .get()
  if (row && row.n > 0) return
  const insertAll = getDb().transaction((agents: AgentConfig[]) => {
    agents.forEach((agent, idx) => upsertAgent(agent, idx))
  })
  insertAll(defaults)
}
