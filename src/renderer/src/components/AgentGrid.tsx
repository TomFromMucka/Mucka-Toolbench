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
import { useLayout } from '../state/LayoutContext'

interface AgentGridProps {
  agents: AgentConfig[]
  gitStatus: GitStatusMap
  restartVersion: Partial<Record<Agent['id'], number>>
}

/** [top, bottom] agent index per column, keyed by column count. */
const AGENT_SEATS: Record<2 | 3, readonly [number, number][]> = {
  2: [
    [0, 2],
    [1, 3]
  ],
  3: [
    [0, 2],
    [1, 3],
    [4, 5]
  ]
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
  const { statusFor, contextUsedPercentFor, modelFor } = useAgentStatuses()
  const { agentColumns } = useLayout()
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
    contextUsedPercent: number | null
    model: string | null
    key: string
  }

  const slotFor = (cfg: AgentConfig | undefined): Slot | null => {
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
  }

  // Seats are fixed rather than derived, so switching between four and six
  // never moves an agent: the first two columns keep the 2x2 pairing
  // exactly, and six-up only adds a third column. A repositioned clipboard
  // remounts, and while that no longer restarts the shell (PtyManager
  // reattaches), it still throws the xterm away — scrollback replay,
  // "reconnected" banner, split tabs collapsing back to one.
  const columns = AGENT_SEATS[agentColumns].map(([top, bottom]) => ({
    top: slotFor(list[top]),
    bottom: slotFor(list[bottom])
  }))

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateColumns: `repeat(${agentColumns}, minmax(0, 1fr))` }}
    >
      {columns.map((column, i) => (
        <AgentColumnStack key={i} top={column.top} bottom={column.bottom} />
      ))}
    </div>
  )
}
