import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentConfig,
  VercelDeployment,
  VercelDeploymentState,
  VercelStatus,
  VercelTarget
} from '@shared/types'

const API_BASE = 'https://api.vercel.com'

interface ProjectLink {
  projectId: string
  /** Team / org id from .vercel/project.json. */
  orgId: string | null
}

interface VercelDeploymentRaw {
  uid?: string
  id?: string
  name?: string
  url?: string
  created?: number
  createdAt?: number
  state?: string
  readyState?: string
  target?: string | null
  inspectorUrl?: string | null
  errorMessage?: string | null
  meta?: {
    githubCommitSha?: string
    githubCommitMessage?: string
    githubCommitRef?: string
    gitlabCommitSha?: string
    gitlabCommitMessage?: string
    gitlabCommitRef?: string
    bitbucketCommitSha?: string
    bitbucketCommitMessage?: string
    bitbucketCommitRef?: string
    deployHookId?: string
    [key: string]: string | undefined
  }
}

function rawState(s: string | undefined): VercelDeploymentState {
  switch (s) {
    case 'QUEUED':
      return 'queued'
    case 'BUILDING':
    case 'INITIALIZING':
      return 'building'
    case 'READY':
      return 'ready'
    case 'ERROR':
      return 'error'
    case 'CANCELED':
      return 'canceled'
    default:
      return 'unknown'
  }
}

function pickCommit(meta: VercelDeploymentRaw['meta']): {
  sha: string | null
  message: string | null
  branch: string | null
} {
  if (!meta) return { sha: null, message: null, branch: null }
  // Vercel uses provider-prefixed keys — try in order.
  const sha =
    meta.githubCommitSha ??
    meta.gitlabCommitSha ??
    meta.bitbucketCommitSha ??
    null
  const message =
    meta.githubCommitMessage ??
    meta.gitlabCommitMessage ??
    meta.bitbucketCommitMessage ??
    null
  const branch =
    meta.githubCommitRef ??
    meta.gitlabCommitRef ??
    meta.bitbucketCommitRef ??
    null
  // Trim message to one line — we render in a tight clipboard row.
  const oneLine = message ? message.split(/\r?\n/)[0]?.trim() ?? null : null
  return { sha, message: oneLine, branch }
}

function normalizeTarget(t: string | null | undefined): VercelTarget {
  if (t === 'production' || t === 'preview' || t === 'staging') return t
  return null
}

function toDeployment(raw: VercelDeploymentRaw): VercelDeployment {
  const state = rawState(raw.readyState ?? raw.state)
  const target = normalizeTarget(raw.target ?? null)
  const { sha, message, branch } = pickCommit(raw.meta)
  const id = raw.uid ?? raw.id ?? ''
  const createdAt = raw.createdAt ?? raw.created ?? 0
  return {
    id,
    projectName: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null,
    isProduction: target === 'production',
    target,
    state,
    branch,
    commitSha: sha,
    commitMessage: message,
    url: raw.url ? `https://${raw.url}` : null,
    createdAt,
    inspectorUrl: raw.inspectorUrl ?? null,
    errorMessage: state === 'error' ? raw.errorMessage ?? null : null
  }
}

/**
 * Reads the Vercel project link checked into a worktree by `vercel link`.
 * Missing/invalid files return null — that's normal for an unconfigured
 * agent and shouldn't produce noise.
 */
export function readProjectLink(worktreePath: string): ProjectLink | null {
  try {
    const file = join(worktreePath, '.vercel', 'project.json')
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      projectId?: string
      orgId?: string
    }
    if (!data.projectId) return null
    return {
      projectId: data.projectId,
      orgId: typeof data.orgId === 'string' ? data.orgId : null
    }
  } catch {
    return null
  }
}

function token(): string | null {
  const t = process.env.VERCEL_API_TOKEN?.trim()
  return t && t.length > 0 ? t : null
}

function defaultTeamId(): string | null {
  const t = process.env.VERCEL_TEAM_ID?.trim()
  return t && t.length > 0 ? t : null
}

/**
 * Vercel's project.json stamps `orgId` as either the user's account id
 * (personal scope) OR a team id. The REST API's `teamId` query param only
 * accepts team ids — sending a user id 403s. Team ids start with `team_`,
 * so we filter on that. Personal projects pass through with teamId = null.
 */
function asTeamScope(orgId: string | null): string | null {
  if (!orgId) return null
  return orgId.startsWith('team_') ? orgId : null
}

export function getStatus(): VercelStatus {
  if (!token()) return { kind: 'missing-token' }
  return { kind: 'ok' }
}

interface FetchOpts {
  signal?: AbortSignal
}

/**
 * Resolves the project id + team scope for an agent.
 * Manual override wins; otherwise we read `.vercel/project.json` from the
 * worktree and use the org id stamped there. Falls back to VERCEL_TEAM_ID
 * if the link file lacks an org id but the user has one in env.
 */
export function resolveProject(agent: AgentConfig): {
  projectId: string | null
  teamId: string | null
  source: 'configured' | 'auto-detected' | 'none'
} {
  if (agent.vercelProjectId && agent.vercelProjectId.trim() !== '') {
    return {
      projectId: agent.vercelProjectId.trim(),
      teamId: asTeamScope(defaultTeamId()),
      source: 'configured'
    }
  }
  const link = readProjectLink(agent.worktreePath)
  if (link) {
    return {
      projectId: link.projectId,
      teamId: asTeamScope(link.orgId) ?? asTeamScope(defaultTeamId()),
      source: 'auto-detected'
    }
  }
  return { projectId: null, teamId: null, source: 'none' }
}

/**
 * Fetch the most recent deployments for one project. Throws on token error;
 * returns [] on missing-project (404).
 */
export async function listDeployments(
  projectId: string,
  teamId: string | null,
  limit = 20,
  opts: FetchOpts = {}
): Promise<VercelDeployment[]> {
  const t = token()
  if (!t) throw new Error('VERCEL_API_TOKEN not set')

  const params = new URLSearchParams()
  params.set('projectId', projectId)
  params.set('limit', String(Math.max(1, Math.min(100, limit))))
  if (teamId) params.set('teamId', teamId)

  const res = await fetch(`${API_BASE}/v6/deployments?${params.toString()}`, {
    headers: { authorization: `Bearer ${t}` },
    signal: opts.signal
  })

  if (res.status === 404) return []
  if (res.status === 401 || res.status === 403) {
    const scope = teamId ? `team ${teamId}` : 'personal'
    const detail = await safeText(res)
    throw new Error(
      `auth rejected (${res.status}) — token can't see ${projectId} as ${scope}. ${detail}`
    )
  }
  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${await safeText(res)}`)
  }

  const body = (await res.json()) as { deployments?: VercelDeploymentRaw[] }
  const rows = Array.isArray(body.deployments) ? body.deployments : []
  return rows.map(toDeployment)
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.slice(0, 200)
  } catch {
    return '(no body)'
  }
}
