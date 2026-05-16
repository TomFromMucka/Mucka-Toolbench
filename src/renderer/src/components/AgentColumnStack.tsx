import { useCallback, useState } from 'react'
import type {
  Agent,
  AgentConfig,
  AgentId,
  GitStatus,
  JobEvent
} from '@shared/types'
import { AgentClipboard, type AgentExpansion } from './AgentClipboard'

/**
 * One column of the agent grid (two stacked AgentClipboards).
 *
 * Owns the column's height layout:
 *   - 'equal'   — 1fr / 1fr (the default)
 *   - 'top'     — top panel maximised, bottom collapsed to header-only
 *   - 'bottom'  — bottom maximised, top collapsed
 *
 * Maximise via the Maximize2 button on either panel; the collapsed
 * panel's whole header is also clickable to restore equal.
 */

type ColumnLayout = 'equal' | 'top' | 'bottom'

interface AgentSlot {
  agent: Agent
  config: AgentConfig
  gitStatus?: GitStatus
  contextPercent: number | null
  /** Stable React key — usually `spawnKey(cfg)::r${restartVersion}`. */
  key: string
}

interface AgentColumnStackProps {
  top: AgentSlot | null
  bottom: AgentSlot | null
}

export function AgentColumnStack({
  top,
  bottom
}: AgentColumnStackProps): React.JSX.Element {
  const [layout, setLayout] = useState<ColumnLayout>('equal')

  const toggleTop = useCallback(() => {
    setLayout((prev) => (prev === 'top' ? 'equal' : 'top'))
  }, [])
  const toggleBottom = useCallback(() => {
    setLayout((prev) => (prev === 'bottom' ? 'equal' : 'bottom'))
  }, [])

  const rows =
    layout === 'top'
      ? '1fr auto'
      : layout === 'bottom'
        ? 'auto 1fr'
        : '1fr 1fr'

  const topExpansion: AgentExpansion =
    layout === 'top' ? 'expanded' : layout === 'bottom' ? 'collapsed' : 'normal'
  const bottomExpansion: AgentExpansion =
    layout === 'bottom' ? 'expanded' : layout === 'top' ? 'collapsed' : 'normal'

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{
        gridTemplateRows: rows,
        transition: 'grid-template-rows 180ms ease'
      }}
    >
      {top ? (
        <AgentClipboard
          key={top.key}
          agent={top.agent}
          config={top.config}
          gitStatus={top.gitStatus}
          contextPercent={top.contextPercent}
          expansion={topExpansion}
          onToggleExpand={toggleTop}
        />
      ) : (
        <EmptySlot />
      )}
      {bottom ? (
        <AgentClipboard
          key={bottom.key}
          agent={bottom.agent}
          config={bottom.config}
          gitStatus={bottom.gitStatus}
          contextPercent={bottom.contextPercent}
          expansion={bottomExpansion}
          onToggleExpand={toggleBottom}
        />
      ) : (
        <EmptySlot />
      )}
    </div>
  )
}

function EmptySlot(): React.JSX.Element {
  return <div />
}

// Re-exports kept for callers that imported these types alongside the
// column-stack component.
export type { AgentExpansion }
export type { Agent, AgentConfig, AgentId, GitStatus, JobEvent }
