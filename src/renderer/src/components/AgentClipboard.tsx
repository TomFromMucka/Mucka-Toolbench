import clsx from 'clsx'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { Agent, AgentConfig, AgentStatus, GitStatus } from '@shared/types'
import { Clipboard } from './Clipboard'
import { AgentTerminalPanel } from './AgentTerminalPanel'
import { GitStatusBadges } from './GitStatusBadges'
import { Icon } from './ui/Icon'

export type AgentExpansion = 'normal' | 'expanded' | 'collapsed'

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
  running: 'bg-status-ok animate-pulse',
  'awaiting-input': 'bg-orange',
  blocked: 'bg-status-bad',
  done: 'bg-status-ok'
}

interface AgentClipboardProps {
  agent: Agent
  config: AgentConfig
  gitStatus?: GitStatus
  /** Claude Code's reported context window usage (0-100). */
  contextPercent?: number | null
  /** Height behaviour within its column — 'normal' fills its row,
   *  'expanded' takes most of the column, 'collapsed' shows header only. */
  expansion?: AgentExpansion
  /** Toggle handler — expand-from-normal, restore-from-expanded,
   *  restore-from-collapsed. */
  onToggleExpand?: () => void
}

export function AgentClipboard({
  agent,
  config,
  gitStatus,
  contextPercent,
  expansion = 'normal',
  onToggleExpand
}: AgentClipboardProps): React.JSX.Element {
  const isCollapsed = expansion === 'collapsed'
  const isExpanded = expansion === 'expanded'

  // Whole-header click restores when the panel is collapsed — gives
  // Tom a fat tap target instead of forcing him to hit the chevron.
  const handleHeaderClick = isCollapsed
    ? () => onToggleExpand?.()
    : undefined

  return (
    <div
      className={clsx(
        'flex min-h-0 flex-col',
        isCollapsed && 'cursor-pointer',
        isExpanded && 'min-h-0'
      )}
      onClick={handleHeaderClick}
      title={isCollapsed ? 'Click to restore equal split' : undefined}
    >
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
        className="min-h-0 flex-1"
        rightSlot={
          <span className="flex items-center gap-2">
            {config.running &&
            typeof contextPercent === 'number' &&
            contextPercent >= 0 ? (
              <span
                className="chamfer-sm px-1.5 py-0.5 font-mono tabular-nums text-[0.65rem]"
                title={`Claude Code context window — ${contextPercent}% remaining`}
                style={{
                  background:
                    contextPercent <= 50
                      ? 'rgba(255, 90, 74, 0.22)'
                      : 'rgba(234, 233, 232, 0.10)',
                  color:
                    contextPercent <= 50
                      ? 'var(--orange)'
                      : 'rgba(234, 233, 232, 0.85)'
                }}
              >
                ctx {contextPercent}%
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
            {onToggleExpand ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand()
                }}
                title={
                  isExpanded
                    ? 'Restore equal split'
                    : isCollapsed
                      ? 'Restore equal split'
                      : 'Maximise — collapse the other panel in this column'
                }
                aria-label="Toggle panel height"
                className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/15"
                style={{ color: 'var(--van-white)' }}
              >
                <Icon
                  icon={isExpanded ? Minimize2 : Maximize2}
                  size={12}
                  strokeWidth={2.25}
                />
              </button>
            ) : null}
          </span>
        }
      >
        {isCollapsed ? null : (
          <div className="flex h-full min-h-0 flex-col">
            <div
              className={clsx(
                't-body-sm border-b px-3 py-1.5 leading-snug',
                agent.needsAttention ? 'text-orange' : 'text-dirty-grey'
              )}
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)'
              }}
            >
              {agent.headline}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <AgentTerminalPanel agent={config} />
            </div>
          </div>
        )}
      </Clipboard>
    </div>
  )
}
