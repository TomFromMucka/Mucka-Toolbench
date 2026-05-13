import clsx from 'clsx'
import type { Agent, AgentStatus } from '@shared/types'
import { Clipboard } from './Clipboard'

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
}

export function AgentClipboard({
  agent
}: AgentClipboardProps): React.JSX.Element {
  return (
    <Clipboard
      title={agent.displayName}
      subtitle={agent.branch}
      attention={agent.needsAttention}
      paper="plain"
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
        {/* sub-headline (the agent's plain-English current activity) */}
        <div
          className={clsx(
            'border-b border-ink/10 px-3 py-2 font-[var(--font-hand)] text-[0.95rem] leading-snug',
            agent.needsAttention ? 'text-mucka-deep' : 'text-ink-soft'
          )}
        >
          {agent.headline}
        </div>

        {/* Mock terminal output — paper styled, not literal xterm yet */}
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2 font-mono text-[0.78rem] leading-[1.35]">
          <div className="flex h-full flex-col gap-[2px]">
            {agent.terminalLines.map((line, idx) => (
              <div
                key={idx}
                className={clsx(
                  'whitespace-pre-wrap',
                  line.kind === 'stderr' && 'text-status-bad',
                  line.kind === 'system' && 'text-ink-faint italic',
                  line.kind === 'prompt' && 'text-mucka-deep font-semibold',
                  line.kind === 'stdout' && 'text-ink'
                )}
              >
                {line.text}
              </div>
            ))}
            {/* blinking cursor */}
            <div className="mt-1 flex items-center gap-1 text-ink-soft">
              <span>▌</span>
              <span className="text-ink-faint">cursor</span>
            </div>
          </div>
        </div>
      </div>
    </Clipboard>
  )
}
