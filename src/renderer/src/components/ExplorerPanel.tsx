import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderTree, FolderOpen } from 'lucide-react'
import type { AgentConfig, AgentId } from '@shared/types'
import { Clipboard } from './Clipboard'
import { Icon } from './ui/Icon'

interface ExplorerPanelProps {
  agents: AgentConfig[]
  collapsed: boolean
  onToggle: () => void
  selectedAgentId: AgentId | null
  onSelectAgent: (id: AgentId) => void
}

function lastSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

export function ExplorerPanel({
  agents,
  collapsed,
  onToggle,
  selectedAgentId,
  onSelectAgent
}: ExplorerPanelProps): React.JSX.Element {
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  )

  if (collapsed) {
    return <CollapsedRail onExpand={onToggle} />
  }

  return (
    <Clipboard
      title="Explorer"
      rightSlot={
        <button
          type="button"
          onClick={onToggle}
          title="Collapse explorer"
          aria-label="Collapse explorer"
          className="grid size-6 place-items-center rounded-sm hover:bg-van-white/15"
          style={{ color: 'rgba(234, 233, 232, 0.85)' }}
        >
          <Icon icon={ChevronLeft} size={16} strokeWidth={2.25} />
        </button>
      }
      className="min-h-0"
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ background: 'var(--surface)' }}
      >
        <WorktreeSwitcher
          agents={agents}
          selectedId={selected?.id ?? null}
          onSelect={onSelectAgent}
        />

        <WorktreeHeader agent={selected} />

        <FileTreePlaceholder cwd={selected?.worktreePath ?? null} />
      </div>
    </Clipboard>
  )
}

function CollapsedRail({ onExpand }: { onExpand: () => void }): React.JSX.Element {
  return (
    <aside
      className="flex h-full min-h-0 flex-col items-center gap-2 py-2"
      style={{ background: 'var(--charcoal)' }}
    >
      <button
        type="button"
        onClick={onExpand}
        title="Expand explorer"
        aria-label="Expand explorer"
        className="chamfer-sm grid size-8 place-items-center transition-colors hover:bg-van-white/10"
        style={{
          color: 'var(--orange)',
          background: 'rgba(234, 233, 232, 0.04)'
        }}
      >
        <Icon icon={FolderTree} size={18} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand explorer"
        title="Expand explorer"
        className="grid size-6 place-items-center rounded-sm hover:bg-van-white/10"
        style={{ color: 'rgba(234, 233, 232, 0.65)' }}
      >
        <Icon icon={ChevronRight} size={14} strokeWidth={2.25} />
      </button>
    </aside>
  )
}

function WorktreeSwitcher({
  agents,
  selectedId,
  onSelect
}: {
  agents: AgentConfig[]
  selectedId: AgentId | null
  onSelect: (id: AgentId) => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
    >
      <Icon icon={FolderOpen} size={14} strokeWidth={2.25} className="shrink-0 text-orange" />
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value as AgentId)}
        className="chamfer-sm t-body-md min-w-0 flex-1 px-2 py-1 focus:outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--van-white)',
          fontFamily: 'var(--font-soehne)',
          fontSize: '13px',
          border: '1px solid var(--border)',
          appearance: 'none'
        }}
        aria-label="Choose worktree"
      >
        {agents.length === 0 ? (
          <option value="">no worktrees</option>
        ) : (
          agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} — {lastSegment(a.worktreePath)}
            </option>
          ))
        )}
      </select>
    </div>
  )
}

function WorktreeHeader({ agent }: { agent: AgentConfig | null }): React.JSX.Element {
  if (!agent) {
    return (
      <div
        className="px-3 py-2 t-body-md"
        style={{ color: 'var(--dirty-grey)' }}
      >
        No worktrees configured.
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        background: 'rgba(234, 233, 232, 0.03)',
        color: 'var(--van-white)'
      }}
    >
      <Icon icon={Folder} size={14} strokeWidth={2.25} className="shrink-0 text-orange" />
      <div className="min-w-0 flex-1">
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontWeight: 500,
            fontSize: '12px',
            letterSpacing: '0.03em',
            textTransform: 'uppercase'
          }}
          title={agent.worktreePath}
        >
          {lastSegment(agent.worktreePath)}
        </div>
        <div
          className="truncate t-label-sm"
          style={{ color: 'var(--dirty-grey)' }}
          title={agent.worktreePath}
        >
          {agent.branch}
        </div>
      </div>
      <button
        type="button"
        title="Reveal in Finder (wired in slice 3)"
        disabled
        className="grid size-6 place-items-center rounded-sm opacity-40"
        style={{ color: 'var(--van-white)' }}
        aria-label="Reveal in Finder"
      >
        <Icon icon={FolderOpen} size={14} strokeWidth={2.25} />
      </button>
    </div>
  )
}

function FileTreePlaceholder({ cwd }: { cwd: string | null }): React.JSX.Element {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3 t-body-sm"
      style={{ color: 'var(--dirty-grey)' }}
    >
      {cwd ? (
        <p className="leading-snug">
          File tree coming in slice 3 — will lazy-load entries under{' '}
          <span className="font-mono text-[0.78rem]">{cwd}</span>.
        </p>
      ) : (
        <p>Select a worktree to browse files.</p>
      )}
    </div>
  )
}

// Helper export for the Workstation layout so the column width stays in
// sync with the panel's intrinsic geometry. Keeping this here means
// Workstation doesn't need to know the magic numbers.
export const EXPLORER_WIDTH_EXPANDED = '280px'
export const EXPLORER_WIDTH_COLLAPSED = '40px'
