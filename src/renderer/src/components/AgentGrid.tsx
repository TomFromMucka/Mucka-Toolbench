import type { AgentConfig, Agent } from '@shared/types'
import { mockAgents } from '../data/mockAgents'
import { AgentColumnStack } from './AgentColumnStack'
import { useAgentSlots } from '../hooks/useAgentSlots'
import type { GitStatusMap } from '../hooks/useGitStatus'
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

export function AgentGrid({
  agents,
  gitStatus,
  restartVersion
}: AgentGridProps): React.JSX.Element {
  const slotFor = useAgentSlots(gitStatus, restartVersion)
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
