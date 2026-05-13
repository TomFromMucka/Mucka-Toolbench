import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import type { WebContents } from 'electron'
import type {
  AgentConfig,
  AgentId,
  GitStatus,
  GitStatusEvent
} from '@shared/types'

const execFileAsync = promisify(execFile)

const POLL_INTERVAL_MS = 5_000
const GIT_TIMEOUT_MS = 4_000

function emptyStatus(reason?: string): GitStatus {
  return {
    isRepo: false,
    branch: null,
    detachedAt: null,
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    modified: 0,
    staged: 0,
    untracked: 0,
    conflicted: 0,
    checkedAt: Date.now(),
    ...(reason ? { reason } : {})
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
}

function parseBranchLine(line: string): {
  branch: string | null
  detachedAt: string | null
  hasUpstream: boolean
  ahead: number
  behind: number
} {
  // Examples we handle:
  //   "## main"                                     no upstream
  //   "## main...origin/main"                       in sync
  //   "## main...origin/main [ahead 1]"
  //   "## main...origin/main [ahead 1, behind 2]"
  //   "## HEAD (no branch)"                         detached
  //   "## No commits yet on main"                   fresh repo
  const body = line.replace(/^##\s*/, '')

  if (body.startsWith('HEAD (no branch)')) {
    return {
      branch: null,
      detachedAt: 'detached',
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }
  }

  if (body.startsWith('No commits yet on ')) {
    const branch = body.slice('No commits yet on '.length).trim() || null
    return {
      branch,
      detachedAt: null,
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }
  }

  // Split off bracket suffix
  let main = body
  let bracket: string | null = null
  const bracketIdx = body.indexOf(' [')
  if (bracketIdx >= 0 && body.endsWith(']')) {
    main = body.slice(0, bracketIdx)
    bracket = body.slice(bracketIdx + 2, -1)
  }

  const upstreamIdx = main.indexOf('...')
  const branch = upstreamIdx >= 0 ? main.slice(0, upstreamIdx).trim() : main.trim()
  const hasUpstream = upstreamIdx >= 0

  let ahead = 0
  let behind = 0
  if (bracket) {
    for (const part of bracket.split(',')) {
      const m = part.trim().match(/^(ahead|behind|gone)\s*(\d+)?/)
      if (!m) continue
      if (m[1] === 'ahead') ahead = Number(m[2] ?? 0)
      else if (m[1] === 'behind') behind = Number(m[2] ?? 0)
    }
  }

  return { branch: branch || null, detachedAt: null, hasUpstream, ahead, behind }
}

function parseStatus(output: string): GitStatus {
  const lines = output.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return emptyStatus('empty git status')

  const head = lines[0]
  if (!head || !head.startsWith('## ')) return emptyStatus('unexpected git status output')

  const branchInfo = parseBranchLine(head)

  let modified = 0
  let staged = 0
  let untracked = 0
  let conflicted = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untracked++
      continue
    }
    if (
      (x === 'U' || y === 'U') ||
      (x === 'A' && y === 'A') ||
      (x === 'D' && y === 'D')
    ) {
      conflicted++
      continue
    }
    if (x && x !== ' ' && x !== '?') staged++
    if (y && y !== ' ' && y !== '?') modified++
  }

  return {
    isRepo: true,
    branch: branchInfo.branch,
    detachedAt: branchInfo.detachedAt,
    hasUpstream: branchInfo.hasUpstream,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    modified,
    staged,
    untracked,
    conflicted,
    checkedAt: Date.now()
  }
}

export async function readGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const s = await stat(cwd)
    if (!s.isDirectory()) return emptyStatus('not a directory')
  } catch {
    return emptyStatus('path missing')
  }

  try {
    const inside = (await git(cwd, 'rev-parse', '--is-inside-work-tree')).trim()
    if (inside !== 'true') return emptyStatus('not a git repo')
  } catch {
    return emptyStatus('not a git repo')
  }

  try {
    const out = await git(cwd, 'status', '--branch', '--porcelain=v1')
    return parseStatus(out)
  } catch {
    return emptyStatus('git status failed')
  }
}

interface GitServiceDeps {
  webContents: WebContents
  getAgents: () => AgentConfig[]
}

/**
 * Polls every agent's worktree on a fixed interval and broadcasts
 * git:status events. Drop into main process — main owns the lifecycle.
 */
export class GitService {
  private timer: NodeJS.Timeout | null = null
  private readonly webContents: WebContents
  private readonly getAgents: () => AgentConfig[]
  private inFlight = new Set<AgentId>()

  constructor(deps: GitServiceDeps) {
    this.webContents = deps.webContents
    this.getAgents = deps.getAgents
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

  async refreshOne(agentId: AgentId): Promise<GitStatus> {
    const agent = this.getAgents().find((a) => a.id === agentId)
    if (!agent) return emptyStatus('unknown agent')
    const status = await readGitStatus(agent.worktreePath)
    this.broadcast({ agentId, status })
    return status
  }

  private async tick(): Promise<void> {
    if (this.webContents.isDestroyed()) return
    const agents = this.getAgents()
    await Promise.all(
      agents.map(async (agent) => {
        if (this.inFlight.has(agent.id)) return
        this.inFlight.add(agent.id)
        try {
          const status = await readGitStatus(agent.worktreePath)
          this.broadcast({ agentId: agent.id, status })
        } finally {
          this.inFlight.delete(agent.id)
        }
      })
    )
  }

  private broadcast(event: GitStatusEvent): void {
    if (this.webContents.isDestroyed()) return
    this.webContents.send('git:status', event)
  }
}
