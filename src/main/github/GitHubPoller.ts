import type { WebContents } from 'electron'
import type {
  AgentConfig,
  AgentId,
  GitHubAgentSummary,
  GitHubUpdateEvent
} from '@shared/types'
import {
  getPullRequest,
  getStatus,
  listCheckRuns,
  listOpenPullRequests,
  readGitHubOrigin,
  rollupChecks
} from './GitHub'

const POLL_INTERVAL_MS = 60_000

interface GitHubPollerDeps {
  webContents: WebContents
  getAgents: () => AgentConfig[]
}

function emptySummary(
  agentId: AgentId,
  repo: GitHubAgentSummary['repo'],
  branch: string,
  error: string | null
): GitHubAgentSummary {
  return {
    agentId,
    repo,
    branch,
    openPr: null,
    checks: [],
    checkSummary: 'none',
    checkedAt: Date.now(),
    error
  }
}

/**
 * Polls open PRs + check runs per agent on a 60s cadence. Skips agents whose
 * worktree origin isn't a GitHub repo. Caches the latest summary per agent
 * and pushes `github:update` events.
 */
export class GitHubPoller {
  private timer: NodeJS.Timeout | null = null
  private readonly webContents: WebContents
  private readonly getAgents: () => AgentConfig[]
  private inFlight = new Map<AgentId, AbortController>()
  private cache = new Map<AgentId, GitHubAgentSummary>()

  constructor(deps: GitHubPollerDeps) {
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
    for (const ctl of this.inFlight.values()) ctl.abort()
    this.inFlight.clear()
  }

  get(agentId: AgentId): GitHubAgentSummary {
    const cached = this.cache.get(agentId)
    if (cached) return cached
    const agent = this.getAgents().find((a) => a.id === agentId)
    if (!agent) return emptySummary(agentId, null, '', 'unknown agent')
    const repo = readGitHubOrigin(agent.worktreePath)
    return emptySummary(agentId, repo, agent.branch, null)
  }

  getAll(): Record<AgentId, GitHubAgentSummary> {
    const out = {} as Record<AgentId, GitHubAgentSummary>
    for (const a of this.getAgents()) out[a.id] = this.get(a.id)
    return out
  }

  async refreshOne(agentId: AgentId): Promise<GitHubAgentSummary> {
    const agent = this.getAgents().find((a) => a.id === agentId)
    if (!agent) {
      const summary = emptySummary(agentId, null, '', 'unknown agent')
      this.broadcast(summary)
      return summary
    }
    return this.pollAgent(agent)
  }

  private async tick(): Promise<void> {
    if (this.webContents.isDestroyed()) return
    if (getStatus().kind !== 'ok') {
      for (const agent of this.getAgents()) {
        const repo = readGitHubOrigin(agent.worktreePath)
        const summary = emptySummary(agent.id, repo, agent.branch, null)
        this.cache.set(agent.id, summary)
        this.broadcast(summary)
      }
      return
    }

    await Promise.all(
      this.getAgents().map(async (agent) => {
        if (this.inFlight.has(agent.id)) return
        await this.pollAgent(agent)
      })
    )
  }

  private async pollAgent(agent: AgentConfig): Promise<GitHubAgentSummary> {
    const repo = readGitHubOrigin(agent.worktreePath)
    if (!repo) {
      const summary = emptySummary(agent.id, null, agent.branch, null)
      this.cache.set(agent.id, summary)
      this.broadcast(summary)
      return summary
    }

    const prior = this.inFlight.get(agent.id)
    if (prior) prior.abort()
    const ctl = new AbortController()
    this.inFlight.set(agent.id, ctl)

    try {
      const prs = await listOpenPullRequests(repo, agent.branch, {
        signal: ctl.signal
      })
      const head = prs[0] ?? null
      let detailed = head
      let checks: GitHubAgentSummary['checks'] = []
      if (head) {
        // PR-detail call fills mergeable/mergeable_state; the list endpoint
        // leaves them undefined.
        detailed = await getPullRequest(repo, head.number, { signal: ctl.signal })
        if (detailed.headSha) {
          checks = await listCheckRuns(repo, detailed.headSha, { signal: ctl.signal })
        }
      }
      const summary: GitHubAgentSummary = {
        agentId: agent.id,
        repo,
        branch: agent.branch,
        openPr: detailed,
        checks,
        checkSummary: rollupChecks(checks),
        checkedAt: Date.now(),
        error: null
      }
      this.cache.set(agent.id, summary)
      this.broadcast(summary)
      return summary
    } catch (err) {
      if (ctl.signal.aborted) return this.get(agent.id)
      const message = err instanceof Error ? err.message : String(err)
      const summary = emptySummary(agent.id, repo, agent.branch, message)
      this.cache.set(agent.id, summary)
      this.broadcast(summary)
      return summary
    } finally {
      if (this.inFlight.get(agent.id) === ctl) this.inFlight.delete(agent.id)
    }
  }

  private broadcast(summary: GitHubAgentSummary): void {
    if (this.webContents.isDestroyed()) return
    const event: GitHubUpdateEvent = { agentId: summary.agentId, summary }
    this.webContents.send('github:update', event)
  }
}
