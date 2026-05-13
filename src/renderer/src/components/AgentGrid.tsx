import type { AgentConfig, Agent } from '@shared/types'
import { mockAgents } from '../data/mockAgents'
import { AgentClipboard } from './AgentClipboard'
import { spawnKey } from '../hooks/useAgents'

interface AgentGridProps {
  agents: AgentConfig[]
}

/**
 * Merges live AgentConfig (id, displayName, branch, worktreePath, command)
 * with mock display state (status, headline, needsAttention) until the
 * real agent activity stream lands.
 */
function mergeWithMockState(cfg: AgentConfig): Agent {
  const mock = mockAgents.find((m) => m.id === cfg.id)
  return {
    id: cfg.id,
    displayName: cfg.displayName,
    branch: cfg.branch,
    worktreePath: cfg.worktreePath,
    status: mock?.status ?? 'idle',
    needsAttention: mock?.needsAttention ?? false,
    headline:
      mock?.headline ??
      `${cfg.displayName} ready at ${cfg.worktreePath}`,
    terminalLines: []
  }
}

export function AgentGrid({ agents }: AgentGridProps): React.JSX.Element {
  // Fall back to mockAgents in the first paint before the DB list arrives.
  const list: AgentConfig[] =
    agents.length > 0
      ? agents
      : mockAgents.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          branch: m.branch,
          worktreePath: m.worktreePath,
          command: 'zsh',
          args: ['-l']
        }))

  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-3">
      {list.map((cfg) => (
        <AgentClipboard
          key={spawnKey(cfg)}
          agent={mergeWithMockState(cfg)}
        />
      ))}
    </div>
  )
}
