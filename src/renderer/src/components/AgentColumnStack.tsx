import { useState } from 'react'
import type {
  Agent,
  AgentConfig,
  AgentId,
  GitStatus,
  JobEvent
} from '@shared/types'
import { AgentClipboard } from './AgentClipboard'
import { rowForSize, type PanelSize } from './panelSize'

/**
 * One column of the agent grid (two stacked AgentClipboards).
 *
 * Each panel carries its own min/mid/max size (set from the header
 * control); the two tracks reflow against each other via grid weights.
 * Panels stay mounted at every size, so a minimised terminal keeps
 * running.
 */

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
  const [sizes, setSizes] = useState<[PanelSize, PanelSize]>(['mid', 'mid'])

  const setTop = (s: PanelSize): void => setSizes(([, b]) => [s, b])
  const setBottom = (s: PanelSize): void => setSizes(([t]) => [t, s])

  const rows = `${rowForSize(sizes[0])} ${rowForSize(sizes[1])}`

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: rows, transition: 'grid-template-rows 180ms ease' }}
    >
      {top ? (
        <AgentClipboard
          key={top.key}
          agent={top.agent}
          config={top.config}
          gitStatus={top.gitStatus}
          contextPercent={top.contextPercent}
          size={sizes[0]}
          onResize={setTop}
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
          size={sizes[1]}
          onResize={setBottom}
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
export type { Agent, AgentConfig, AgentId, GitStatus, JobEvent }
