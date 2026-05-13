import clsx from 'clsx'
import type { Agent, AgentStatus, GitStatus } from '@shared/types'
import { Clipboard } from './Clipboard'
import { AgentTerminal } from './AgentTerminal'
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
  idle: 'bg-ink-faint',
  thinking: 'bg-status-warn',
  editing: 'bg-status-ok',
  running: 'bg-status-ok animate-pulse',
  'awaiting-input': 'bg-mucka',
  blocked: 'bg-status-bad',
  done: 'bg-status-ok'
}

interface AgentClipboardProps {
  agent: Agent
  gitStatus?: GitStatus
}

export function AgentClipboard({
  agent,
  gitStatus
}: AgentClipboardProps): React.JSX.Element {
  return (
    <Clipboard
      title={agent.displayName}
      subtitle={
        <GitStatusBadges status={gitStatus} fallbackLabel={agent.branch} />
      }
      attention={agent.needsAttention}
      paper="plain"
      bodyClassName="bg-[#1a1612]"
      rightSlot={
        <span className="flex items-center gap-1.5 text-paper-cream/80">
          <span
            className={clsx(
              'inline-block size-2 rounded-full',
              STATUS_DOT[agent.status]
            )}
          />
          {STATUS_LABEL[agent.status]}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={clsx(
            'border-b border-black/60 bg-paper-cream px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug',
            agent.needsAttention ? 'text-mucka-deep' : 'text-ink-soft'
          )}
        >
          {agent.headline}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-1">
          <AgentTerminal agentId={agent.id} />
        </div>
      </div>
    </Clipboard>
  )
}
