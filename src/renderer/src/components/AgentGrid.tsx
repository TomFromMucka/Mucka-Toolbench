import type {
  AgentConfig,
  Agent,
  AgentId,
  AgentStatus,
  GitStatus,
  JobEvent
} from '@shared/types'
import { mockAgents } from '../data/mockAgents'
import { AgentColumnStack } from './AgentColumnStack'
import { spawnKey } from '../hooks/useAgents'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useEventsState } from '../state/EventsContext'
import { useAgentStatuses } from '../state/AgentStatusContext'

interface AgentGridProps {
  agents: AgentConfig[]
  gitStatus: GitStatusMap
  restartVersion: Partial<Record<Agent['id'], number>>
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

function findLatestForAgent(
  events: JobEvent[],
  agentId: AgentId
): JobEvent | null {
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
    headline:
      cfg.attentionReason ??
      eventHeadline ??
      `${cfg.displayName} at ${cfg.worktreePath}`,
    terminalLines: []
  }
}

export function AgentGrid({
  agents,
  gitStatus,
  restartVersion
}: AgentGridProps): React.JSX.Element {
  const { events } = useEventsState()
  const { statusFor, contextPercentFor } = useAgentStatuses()
  const list: AgentConfig[] =
    agents.length > 0
      ? agents
      : mockAgents.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          branch: m.branch,
          worktreePath: m.worktreePath,
          command: 'zsh',
          args: ['-l'],
          needsAttention: false,
          attentionReason: null,
          previewUrl: null,
          vercelProjectId: null,
          running: false
        }))

  interface Slot {
    agent: Agent
    config: AgentConfig
    gitStatus: GitStatus | undefined
    contextPercent: number | null
    key: string
  }

  const slotFor = (cfg: AgentConfig | undefined): Slot | null => {
    if (!cfg) return null
    const liveStatus = cfg.needsAttention ? 'awaiting-input' : statusFor(cfg.id)
    return {
      agent: buildAgent(cfg, findLatestForAgent(events, cfg.id), liveStatus),
      config: cfg,
      gitStatus: gitStatus[cfg.id],
      contextPercent: contextPercentFor(cfg.id),
      key: `${spawnKey(cfg)}::r${restartVersion[cfg.id] ?? 0}`
    }
  }

  // Visual layout is a 2x2 grid: indexes 0 & 1 across the top row,
  // 2 & 3 across the bottom. Reshape into two column stacks so each
  // column can own its own expand/collapse state independently.
  const leftTop = slotFor(list[0])
  const leftBottom = slotFor(list[2])
  const rightTop = slotFor(list[1])
  const rightBottom = slotFor(list[3])

  return (
    <div className="grid min-h-0 grid-cols-2 gap-3">
      <AgentColumnStack top={leftTop} bottom={leftBottom} />
      <AgentColumnStack top={rightTop} bottom={rightBottom} />
    </div>
  )
}
