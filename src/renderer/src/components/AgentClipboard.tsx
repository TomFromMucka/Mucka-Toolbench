import clsx from 'clsx'
import type { Agent, AgentConfig, AgentStatus, GitStatus } from '@shared/types'
import { Clipboard } from './Clipboard'
import { AgentTerminalPanel } from './AgentTerminalPanel'
import { GitStatusBadges } from './GitStatusBadges'

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  editing: 'editing',
  running: 'running',
  'awaiting-input': 'awaits Tom',
  blocked: 'blocked',
  done: 'done'
}

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-dirty-grey',
  thinking: 'bg-status-warn',
  editing: 'bg-status-ok',
  running: 'bg-status-ok animate-pulse',
  'awaiting-input': 'bg-orange',
  blocked: 'bg-status-bad',
  done: 'bg-status-ok'
}

interface AgentClipboardProps {
  agent: Agent
  config: AgentConfig
  gitStatus?: GitStatus
}

export function AgentClipboard({
  agent,
  config,
  gitStatus
}: AgentClipboardProps): React.JSX.Element {
  return (
    <Clipboard
      title={agent.displayName}
      subtitle={
        <GitStatusBadges status={gitStatus} fallbackLabel={agent.branch} />
      }
      attention={
        agent.needsAttention ||
        agent.status === 'awaiting-input' ||
        agent.status === 'blocked'
      }
      bodyClassName="bg-surface-2"
      rightSlot={
        <span className="flex items-center gap-1.5">
          <span
            className={clsx(
              'inline-block size-2 rounded-full',
              config.running ? STATUS_DOT[agent.status] : 'bg-dirty-grey'
            )}
          />
          <span style={{ color: 'rgba(234, 233, 232, 0.85)' }}>
            {config.running ? STATUS_LABEL[agent.status] : 'stopped'}
          </span>
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={clsx(
            't-body-sm border-b px-3 py-1.5 leading-snug',
            agent.needsAttention ? 'text-orange' : 'text-dirty-grey'
          )}
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          {agent.headline}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <AgentTerminalPanel agent={config} />
        </div>
      </div>
    </Clipboard>
  )
}
