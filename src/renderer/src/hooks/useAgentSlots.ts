import { useCallback } from 'react'
import type { Agent, AgentConfig, AgentId, AgentStatus, GitStatus, JobEvent } from '@shared/types'
import { spawnKey } from './useAgents'
import type { GitStatusMap } from './useGitStatus'
import { useEventsState } from '../state/EventsContext'
import { useAgentStatuses } from '../state/AgentStatusContext'

/** Everything one AgentClipboard needs, ready to render. */
export interface AgentSlot {
  agent: Agent
  config: AgentConfig
  gitStatus: GitStatus | undefined
  contextUsedPercent: number | null
  model: string | null
  /**
   * Stable React key. The grid and the Jobs layout use the same one, so a
   * clipboard keeps its xterm for as long as it stays in the same layout.
   */
  key: string
}

function relativeShort(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function findLatestForAgent(events: JobEvent[], agentId: AgentId): JobEvent | null {
  for (const event of events) {
    if (event.source === agentId) return event
  }
  return null
}

/**
 * Combines DB-backed AgentConfig with the live event feed and PTY-derived
 * status. Headline shows the agent's latest event with a "Ns ago" tail,
 * falling back to a default line.
 *
 * Priority: attentionReason (Mucka has flagged Tom) > latest event > default.
 */
function buildAgent(
  cfg: AgentConfig,
  latestEvent: JobEvent | null,
  liveStatus: AgentStatus
): Agent {
  const eventHeadline = latestEvent
    ? `${latestEvent.message} · ${relativeShort(latestEvent.ts)}`
    : null
  return {
    id: cfg.id,
    displayName: cfg.displayName,
    branch: cfg.branch,
    worktreePath: cfg.worktreePath,
    status: liveStatus,
    needsAttention: cfg.needsAttention,
    headline: cfg.attentionReason ?? eventHeadline ?? `${cfg.displayName} at ${cfg.worktreePath}`,
    terminalLines: []
  }
}

/**
 * Builds the slot for an agent's clipboard from its config, the live event
 * feed and Claude's reported status. Shared by the agent grid and the Jobs
 * layout so both render a clipboard the same way.
 */
export function useAgentSlots(
  gitStatus: GitStatusMap,
  restartVersion: Partial<Record<Agent['id'], number>>
): (cfg: AgentConfig | undefined) => AgentSlot | null {
  const { events } = useEventsState()
  const { statusFor, contextUsedPercentFor, modelFor } = useAgentStatuses()
  return useCallback(
    (cfg: AgentConfig | undefined): AgentSlot | null => {
      if (!cfg) return null
      const liveStatus = cfg.needsAttention ? 'awaiting-input' : statusFor(cfg.id)
      return {
        agent: buildAgent(cfg, findLatestForAgent(events, cfg.id), liveStatus),
        config: cfg,
        gitStatus: gitStatus[cfg.id],
        contextUsedPercent: contextUsedPercentFor(cfg.id),
        model: modelFor(cfg.id),
        key: `${spawnKey(cfg)}::r${restartVersion[cfg.id] ?? 0}`
      }
    },
    [events, statusFor, contextUsedPercentFor, modelFor, gitStatus, restartVersion]
  )
}
