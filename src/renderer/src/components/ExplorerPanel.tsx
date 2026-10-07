import { useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderTree,
  FolderOpen,
  FolderSearch
} from 'lucide-react'
import type { AgentConfig, AgentId } from '@shared/types'
import { Clipboard } from './Clipboard'
import { FileTree } from './FileTree'
import { Icon } from './ui/Icon'
import { useFileTree } from '../hooks/useFileTree'

interface ExplorerPanelProps {
  agents: AgentConfig[]
  collapsed: boolean
  onToggle: () => void
  selectedAgentId: AgentId | null
  onSelectAgent: (id: AgentId) => void
  /**
   * A job's worktree to show instead of the selected agent's. Set in the
   * Jobs layout when the job on screen is a job rather than an agent.
   */
  job?: { worktreePath: string; branch: string } | null
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
  onSelectAgent,
  job = null
}: ExplorerPanelProps): React.JSX.Element {
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  )

  const shown =
    job ?? (selected ? { worktreePath: selected.worktreePath, branch: selected.branch } : null)
  const tree = useFileTree(shown?.worktreePath ?? null)

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
      <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface)' }}>
        <WorktreeSwitcher
          agents={agents}
          selectedId={selected?.id ?? null}
          onSelect={onSelectAgent}
        />

        <WorktreeHeader worktree={shown} />

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <FileTree api={tree} />
        </div>
      </div>
    </Clipboard>
  )
}

function CollapsedRail({ onExpand }: { onExpand: () => void }): React.JSX.Element {
  // The whole bar is the target: a 40px strip is easy to hit anywhere along
  // its length, and fiddly if only a small icon at the top responds.
  return (
    <button
      type="button"
      onClick={onExpand}
      title="Show files"
      aria-label="Show files"
      className="flex h-full min-h-0 flex-col items-center gap-3 py-3 transition-colors hover:bg-van-white/10"
      style={{ background: 'var(--charcoal)', color: 'var(--van-white)' }}
    >
      <Icon icon={FolderTree} size={18} strokeWidth={2.25} />
      <span
        className="t-label-sm tracking-[0.16em]"
        style={{ writingMode: 'vertical-rl', color: 'rgba(234, 233, 232, 0.7)' }}
      >
        FILES
      </span>
      <Icon icon={ChevronRight} size={14} strokeWidth={2.25} className="mt-auto opacity-60" />
    </button>
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
      <Icon icon={FolderOpen} size={14} strokeWidth={2.25} className="shrink-0 text-van-white/80" />
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

function WorktreeHeader({
  worktree
}: {
  worktree: { worktreePath: string; branch: string } | null
}): React.JSX.Element {
  if (!worktree) {
    return (
      <div className="px-3 py-2 t-body-md" style={{ color: 'var(--dirty-grey)' }}>
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
      <Icon icon={Folder} size={14} strokeWidth={2.25} className="shrink-0 text-van-white/80" />
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
          title={worktree.worktreePath}
        >
          {lastSegment(worktree.worktreePath)}
        </div>
        <div
          className="truncate t-label-sm"
          style={{ color: 'var(--dirty-grey)' }}
          title={worktree.worktreePath}
        >
          {worktree.branch}
        </div>
      </div>
      <button
        type="button"
        title="Reveal in Finder"
        onClick={() => void window.mucka.revealInOs(worktree.worktreePath)}
        className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/15"
        style={{ color: 'var(--van-white)' }}
        aria-label="Reveal in Finder"
      >
        <Icon icon={FolderSearch} size={14} strokeWidth={2.25} />
      </button>
    </div>
  )
}

// Helper export for the Workstation layout so the column width stays in
// sync with the panel's intrinsic geometry. Keeping this here means
// Workstation doesn't need to know the magic numbers.
export const EXPLORER_WIDTH_EXPANDED = '280px'
export const EXPLORER_WIDTH_COLLAPSED = '40px'
