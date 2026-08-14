import clsx from 'clsx'
import type { Agent, AgentConfig, AgentStatus, GitStatus } from '@shared/types'
import { Clipboard } from './Clipboard'
import type { PanelSize } from './panelSize'
import { AgentTerminalPanel } from './AgentTerminalPanel'
import { GitStatusBadges } from './GitStatusBadges'

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  editing: 'editing',
  running: 'running',
  'awaiting-input': 'awaits input',
  blocked: 'blocked',
  done: 'done'
}

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-dirty-grey',
  thinking: 'bg-status-warn',
  editing: 'bg-status-ok',
  running: 'bg-status-ok',
  'awaiting-input': 'bg-orange',
  blocked: 'bg-status-bad',
  done: 'bg-status-ok'
}

interface AgentClipboardProps {
  agent: Agent
  config: AgentConfig
  gitStatus?: GitStatus
  /** Percent of the context window consumed (0-100). */
  contextUsedPercent?: number | null
  /** Model display name from the status line, e.g. "Opus 5 (1M context)". */
  model?: string | null
  /** Height within its column — driven by the header's min/mid/max control. */
  size?: PanelSize
  onResize?: (size: PanelSize) => void
}

/**
 * "Opus 5 (1M context)" → "Opus 5". The parenthetical is the first thing
 * to go when a six-up column is narrow; the full name stays in the title.
 */
function compactModel(model: string): string {
  return model.replace(/\s*\([^)]*\)\s*$/, '').trim() || model
}

export function AgentClipboard({
  agent,
  config,
  gitStatus,
  contextUsedPercent,
  model,
  size = 'mid',
  onResize
}: AgentClipboardProps): React.JSX.Element {
  return (
    <Clipboard
      title={agent.displayName}
      subtitle={<GitStatusBadges status={gitStatus} fallbackLabel={agent.branch} />}
      attention={
        agent.needsAttention ||
        agent.status === 'awaiting-input' ||
        agent.status === 'blocked'
      }
      bodyClassName="bg-surface-2"
      className="min-h-0"
      size={size}
      onResize={onResize}
      rightSlot={
        <span className="flex min-w-0 items-center gap-2">
          {config.running && model ? (
            <span
              className="chamfer-sm max-w-[9rem] truncate px-1.5 py-0.5 text-[0.65rem]"
              title={`Claude Code model — ${model}`}
              style={{
                background: 'rgba(234, 233, 232, 0.10)',
                color: 'rgba(234, 233, 232, 0.85)'
              }}
            >
              {compactModel(model)}
            </span>
          ) : null}
          {config.running &&
          typeof contextUsedPercent === 'number' &&
          contextUsedPercent >= 0 ? (
            <span
              className="chamfer-sm px-1.5 py-0.5 font-mono tabular-nums text-[0.65rem]"
              title={`Claude Code context window — ${contextUsedPercent}% used, ${100 - contextUsedPercent}% left`}
              style={{
                background:
                  contextUsedPercent >= 50
                    ? 'rgba(255, 90, 74, 0.22)'
                    : 'rgba(234, 233, 232, 0.10)',
                color:
                  contextUsedPercent >= 50
                    ? 'var(--orange)'
                    : 'rgba(234, 233, 232, 0.85)'
              }}
            >
              ctx {contextUsedPercent}%
            </span>
          ) : null}
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
        </span>
      }
    >
      {/* Body stays mounted at every size (Clipboard hides it when 'min')
          so the PTY, xterm view, and any preview/sub-terminal tabs keep
          running while the panel is minimised. */}
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
