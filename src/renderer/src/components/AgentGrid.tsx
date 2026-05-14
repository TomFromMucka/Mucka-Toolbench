import type { AgentConfig, Agent } from '@shared/types'
import { mockAgents } from '../data/mockAgents'
import { AgentClipboard } from './AgentClipboard'
import { spawnKey } from '../hooks/useAgents'
import type { GitStatusMap } from '../hooks/useGitStatus'

interface AgentGridProps {
  agents: AgentConfig[]
  gitStatus: GitStatusMap
  restartVersion: Partial<Record<Agent['id'], number>>
}

/**
 * Combines DB-backed AgentConfig with the still-mocked display state
 * (status, headline). `needsAttention` and `attentionReason` are now
 * real and live on AgentConfig — Mucka can flip them via tools.
 */
function mergeWithMockState(cfg: AgentConfig): Agent {
  const mock = mockAgents.find((m) => m.id === cfg.id)
  return {
    id: cfg.id,
    displayName: cfg.displayName,
    branch: cfg.branch,
    worktreePath: cfg.worktreePath,
    status: mock?.status ?? 'idle',
    needsAttention: cfg.needsAttention,
    headline:
      cfg.attentionReason ??
      mock?.headline ??
      `${cfg.displayName} ready at ${cfg.worktreePath}`,
    terminalLines: []
  }
}

export function AgentGrid({
  agents,
  gitStatus,
  restartVersion
}: AgentGridProps): React.JSX.Element {
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
          vercelProjectId: null
        }))

  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-3">
      {list.map((cfg) => (
        <AgentClipboard
          key={`${spawnKey(cfg)}::r${restartVersion[cfg.id] ?? 0}`}
          agent={mergeWithMockState(cfg)}
          config={cfg}
          gitStatus={gitStatus[cfg.id]}
        />
      ))}
    </div>
  )
}
