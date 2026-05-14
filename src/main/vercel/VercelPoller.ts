import type { WebContents } from 'electron'
import type {
  AgentConfig,
  AgentId,
  VercelAgentSummary,
  VercelDeployment,
  VercelDeploymentState,
  VercelUpdateEvent
} from '@shared/types'
import { listDeployments, resolveProject, getStatus } from './Vercel'
import { logEvent } from '../events/Events'

const POLL_INTERVAL_MS = 30_000
const DEPLOYMENT_LIMIT = 20

interface VercelPollerDeps {
  webContents: WebContents
  getAgents: () => AgentConfig[]
}

function emptySummary(
  agentId: AgentId,
  source: VercelAgentSummary['source'],
  projectId: string | null,
  error: string | null
): VercelAgentSummary {
  return {
    agentId,
    projectId,
    source,
    latestProduction: null,
    latestForBranch: null,
    latestAny: null,
    checkedAt: Date.now(),
    error
  }
}

function pickLatest(
  list: VercelDeployment[],
  predicate: (d: VercelDeployment) => boolean
): VercelDeployment | null {
  let best: VercelDeployment | null = null
  for (const d of list) {
    if (!predicate(d)) continue
    if (best === null || d.createdAt > best.createdAt) best = d
  }
  return best
}

/**
 * Polls Vercel for every agent that has a resolvable project (manually
 * configured OR auto-detected via .vercel/project.json). Caches the latest
 * summary per agent and broadcasts `vercel:update` whenever a poll completes.
 */
export class VercelPoller {
  private timer: NodeJS.Timeout | null = null
  private readonly webContents: WebContents
  private readonly getAgents: () => AgentConfig[]
  private inFlight = new Map<AgentId, AbortController>()
  private cache = new Map<AgentId, VercelAgentSummary>()

  constructor(deps: VercelPollerDeps) {
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

  get(agentId: AgentId): VercelAgentSummary {
    const cached = this.cache.get(agentId)
    if (cached) return cached
    const agent = this.getAgents().find((a) => a.id === agentId)
    if (!agent) return emptySummary(agentId, 'none', null, 'unknown agent')
    const { projectId, source } = resolveProject(agent)
    return emptySummary(agentId, source, projectId, null)
  }

  getAll(): Record<AgentId, VercelAgentSummary> {
    const out = {} as Record<AgentId, VercelAgentSummary>
    for (const a of this.getAgents()) out[a.id] = this.get(a.id)
    return out
  }

  async refreshOne(agentId: AgentId): Promise<VercelAgentSummary> {
    const agent = this.getAgents().find((a) => a.id === agentId)
    if (!agent) {
      const summary = emptySummary(agentId, 'none', null, 'unknown agent')
      this.broadcast(summary)
      return summary
    }
    return this.pollAgent(agent)
  }

  private async tick(): Promise<void> {
    if (this.webContents.isDestroyed()) return
    if (getStatus().kind !== 'ok') {
      // No token — still update each agent's summary so the renderer
      // shows the "missing token" state with current project resolution.
      for (const agent of this.getAgents()) {
        const { projectId, source } = resolveProject(agent)
        const summary = emptySummary(agent.id, source, projectId, null)
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

  private async pollAgent(agent: AgentConfig): Promise<VercelAgentSummary> {
    const { projectId, teamId, source } = resolveProject(agent)
    if (!projectId) {
      const summary = emptySummary(agent.id, source, null, null)
      this.cache.set(agent.id, summary)
      this.broadcast(summary)
      return summary
    }

    // Cancel any prior in-flight poll for this agent so we don't double up.
    const prior = this.inFlight.get(agent.id)
    if (prior) prior.abort()
    const ctl = new AbortController()
    this.inFlight.set(agent.id, ctl)

    try {
      const deployments = await listDeployments(
        projectId,
        teamId,
        DEPLOYMENT_LIMIT,
        { signal: ctl.signal }
      )
      const summary: VercelAgentSummary = {
        agentId: agent.id,
        projectId,
        source,
        latestProduction: pickLatest(deployments, (d) => d.isProduction),
        latestForBranch: pickLatest(
          deployments,
          (d) => d.branch !== null && d.branch === agent.branch
        ),
        latestAny: deployments[0] ?? null,
        checkedAt: Date.now(),
        error: null
      }
      const previous = this.cache.get(agent.id) ?? null
      this.cache.set(agent.id, summary)
      this.emitTransitionEvents(agent, previous, summary)
      this.broadcast(summary)
      return summary
    } catch (err) {
      if (ctl.signal.aborted) {
        return this.get(agent.id)
      }
      const message = err instanceof Error ? err.message : String(err)
      const summary = emptySummary(agent.id, source, projectId, message)
      this.cache.set(agent.id, summary)
      this.broadcast(summary)
      return summary
    } finally {
      if (this.inFlight.get(agent.id) === ctl) this.inFlight.delete(agent.id)
    }
  }

  private broadcast(summary: VercelAgentSummary): void {
    if (this.webContents.isDestroyed()) return
    const event: VercelUpdateEvent = { agentId: summary.agentId, summary }
    this.webContents.send('vercel:update', event)
  }

  /**
   * Inspect the relevant pair of deployments (latestForBranch ?? latestAny)
   * and emit a job-sheet event when the deployment id or readyState
   * changed. Skipped on first poll (no previous cache) to avoid a noisy
   * boot-time burst.
   */
  private emitTransitionEvents(
    agent: AgentConfig,
    prior: VercelAgentSummary | null,
    next: VercelAgentSummary
  ): void {
    if (!prior) return
    const pickRelevant = (s: VercelAgentSummary): VercelDeployment | null =>
      s.latestForBranch ?? s.latestAny ?? null
    const before = pickRelevant(prior)
    const after = pickRelevant(next)
    if (!after) return
    // Only log when the deployment id changed or its state moved.
    const sameId = before?.id === after.id
    const sameState = before?.state === after.state
    if (sameId && sameState) return

    const action = sameId ? 'transitioned' : 'started'
    const stateLabel = labelForState(after.state)
    const target = after.isProduction ? 'prod' : 'preview'
    const branch = after.branch ?? agent.branch
    const message = sameId
      ? `Vercel ${target} on ${branch} — ${stateLabel}`
      : `Vercel ${target} ${action} on ${branch} (${stateLabel})`
    const tone = after.state === 'error' ? 'bad' : after.state === 'ready' ? 'win' : 'normal'
    logEvent({
      source: agent.id,
      kind: `vercel.${after.state}`,
      message,
      tone
    })
  }
}

function labelForState(s: VercelDeploymentState): string {
  switch (s) {
    case 'queued':
      return 'queued'
    case 'building':
      return 'building'
    case 'ready':
      return 'ready ✓'
    case 'error':
      return 'failed ✗'
    case 'canceled':
      return 'canceled'
    default:
      return s
  }
}
