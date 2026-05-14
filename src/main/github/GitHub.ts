import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CheckRun,
  CheckSummary,
  GitHubStatus,
  PullRequest,
  PullRequestState
} from '@shared/types'

const API_BASE = 'https://api.github.com'

interface RepoLink {
  owner: string
  name: string
}

interface PullRaw {
  number?: number
  title?: string
  html_url?: string
  state?: 'open' | 'closed'
  draft?: boolean
  user?: { login?: string }
  head?: { ref?: string; sha?: string }
  base?: { ref?: string }
  mergeable?: boolean | null
  mergeable_state?: string | null
  merged?: boolean
  merged_at?: string | null
  created_at?: string
  updated_at?: string
}

interface CheckRunRaw {
  name?: string
  status?: 'queued' | 'in_progress' | 'completed'
  conclusion?: string | null
  html_url?: string | null
}

/**
 * Parse `owner/repo` out of a git origin URL. Handles SSH and HTTPS forms,
 * with or without a trailing .git. Returns null for non-GitHub origins.
 */
export function parseGitHubOrigin(url: string): RepoLink | null {
  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  // SSH: git@github.com:owner/repo(.git)?
  let m = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (m && m[1] && m[2]) return { owner: m[1], name: m[2] }

  // HTTPS: https://github.com/owner/repo(.git)?
  m = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (m && m[1] && m[2]) return { owner: m[1], name: m[2] }

  return null
}

/**
 * Read the `[remote "origin"]` url from .git/config in the given worktree
 * and parse it. Returns null when there's no .git/config, no origin, or it
 * points somewhere other than github.com.
 */
export function readGitHubOrigin(worktreePath: string): RepoLink | null {
  try {
    const file = join(worktreePath, '.git', 'config')
    if (!existsSync(file)) return null
    const cfg = readFileSync(file, 'utf8')
    // Naive INI scan — find the [remote "origin"] section and pluck `url = ...`.
    const lines = cfg.split('\n')
    let inOrigin = false
    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith('[')) {
        inOrigin = /^\[remote\s+"origin"\]$/.test(line)
        continue
      }
      if (!inOrigin) continue
      const m = line.match(/^url\s*=\s*(.+)$/i)
      if (m && m[1]) return parseGitHubOrigin(m[1])
    }
    return null
  } catch {
    return null
  }
}

function token(): string | null {
  const t =
    process.env.GITHUB_TOKEN?.trim() ?? process.env.GH_TOKEN?.trim() ?? ''
  return t.length > 0 ? t : null
}

export function getStatus(): GitHubStatus {
  if (!token()) return { kind: 'missing-token' }
  return { kind: 'ok' }
}

interface FetchOpts {
  signal?: AbortSignal
}

async function ghFetch<T>(
  path: string,
  t: string,
  opts: FetchOpts = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${t}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    },
    signal: opts.signal
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`auth rejected (${res.status}) — ${await safeText(res)}`)
  }
  if (res.status === 404) {
    throw new Error(`not found (404) — ${path}`)
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await safeText(res)}`)
  }
  return (await res.json()) as T
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.slice(0, 200)
  } catch {
    return '(no body)'
  }
}

function isoToMs(s: string | undefined): number {
  if (!s) return 0
  const n = Date.parse(s)
  return Number.isFinite(n) ? n : 0
}

function rawState(p: PullRaw): PullRequestState {
  if (p.merged || p.merged_at) return 'merged'
  if (p.state === 'closed') return 'closed'
  if (p.draft) return 'draft'
  return 'open'
}

function toPullRequest(p: PullRaw): PullRequest {
  return {
    number: p.number ?? 0,
    title: p.title ?? '(no title)',
    url: p.html_url ?? '',
    state: rawState(p),
    isDraft: Boolean(p.draft),
    authorLogin: p.user?.login ?? null,
    headBranch: p.head?.ref ?? '',
    baseBranch: p.base?.ref ?? '',
    mergeableState: p.mergeable_state ?? null,
    mergeable: typeof p.mergeable === 'boolean' ? p.mergeable : null,
    headSha: p.head?.sha ?? '',
    createdAt: isoToMs(p.created_at),
    updatedAt: isoToMs(p.updated_at)
  }
}

function toCheckRun(c: CheckRunRaw): CheckRun {
  const allowedConclusions = new Set([
    'success',
    'failure',
    'neutral',
    'cancelled',
    'timed_out',
    'action_required',
    'skipped',
    'stale'
  ])
  const conclusion =
    typeof c.conclusion === 'string' && allowedConclusions.has(c.conclusion)
      ? (c.conclusion as CheckRun['conclusion'])
      : null
  return {
    name: c.name ?? '(unnamed)',
    status: c.status ?? 'queued',
    conclusion,
    url: c.html_url ?? null
  }
}

export function rollupChecks(checks: CheckRun[]): CheckSummary {
  if (checks.length === 0) return 'none'
  let anyPending = false
  let anyFailure = false
  for (const c of checks) {
    if (c.status !== 'completed') {
      anyPending = true
      continue
    }
    if (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required') {
      anyFailure = true
    }
  }
  if (anyFailure) return 'failure'
  if (anyPending) return 'pending'
  return 'success'
}

/**
 * List open PRs whose head ref matches the given branch. The PR list API
 * filters by `head=owner:branch` for same-repo PRs. For PRs from forks we
 * still try without the owner prefix but they may not match.
 */
export async function listOpenPullRequests(
  repo: RepoLink,
  branch: string,
  opts: FetchOpts = {}
): Promise<PullRequest[]> {
  const t = token()
  if (!t) throw new Error('GITHUB_TOKEN not set')
  if (!branch) return []
  const params = new URLSearchParams({
    state: 'open',
    head: `${repo.owner}:${branch}`,
    per_page: '5'
  })
  const path = `/repos/${repo.owner}/${repo.name}/pulls?${params.toString()}`
  const raw = await ghFetch<PullRaw[]>(path, t, opts)
  return raw.map(toPullRequest)
}

/**
 * Fetch detail for a single PR — needed because the list endpoint doesn't
 * populate mergeable / mergeable_state.
 */
export async function getPullRequest(
  repo: RepoLink,
  number: number,
  opts: FetchOpts = {}
): Promise<PullRequest> {
  const t = token()
  if (!t) throw new Error('GITHUB_TOKEN not set')
  const path = `/repos/${repo.owner}/${repo.name}/pulls/${number}`
  const raw = await ghFetch<PullRaw>(path, t, opts)
  return toPullRequest(raw)
}

export async function listCheckRuns(
  repo: RepoLink,
  sha: string,
  opts: FetchOpts = {}
): Promise<CheckRun[]> {
  const t = token()
  if (!t) throw new Error('GITHUB_TOKEN not set')
  if (!sha) return []
  const path = `/repos/${repo.owner}/${repo.name}/commits/${sha}/check-runs?per_page=50`
  const raw = await ghFetch<{ check_runs?: CheckRunRaw[] }>(path, t, opts)
  const list = Array.isArray(raw.check_runs) ? raw.check_runs : []
  return list.map(toCheckRun)
}
