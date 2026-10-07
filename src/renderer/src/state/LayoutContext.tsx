import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentConfig } from '@shared/types'
import { useAgentsState } from './AgentsContext'

/**
 * How many agent terminals the cockpit shows. Six only fits by giving up
 * the right column (previews, Vercel, git), so the count drives the whole
 * top-level layout rather than just the agent grid.
 */
export type TerminalCount = 4 | 6

/**
 * The cockpit's shape. The two grids give every agent a seat on screen.
 * Jobs gives the screen to work instead: who needs Tom, a board of what
 * each agent is on, and one job's terminal at full size
 * (docs/jobs-layout-plan.md).
 */
export type LayoutMode = TerminalCount | 'jobs'

const STORAGE_KEY = 'layout.terminalCount'

interface LayoutValue {
  layout: LayoutMode
  setLayout: (next: LayoutMode) => void
  isJobs: boolean
  /** Agents with a place in this layout. Jobs lists them all, like six-up. */
  terminalCount: TerminalCount
  /** Agent-grid columns — each column is a stack of two clipboards. */
  agentColumns: 2 | 3
  /** False in 6-up: browser previews, Vercel and git are hidden. */
  showRightColumn: boolean
}

const Ctx = createContext<LayoutValue | null>(null)

function readLayout(): LayoutMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'jobs') return 'jobs'
    return stored === '6' ? 6 : 4
  } catch {
    return 4
  }
}

export function LayoutProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [layout, setLayoutState] = useState<LayoutMode>(readLayout)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(layout))
    } catch {
      /* storage disabled */
    }
  }, [layout])

  const setLayout = useCallback((next: LayoutMode) => {
    setLayoutState(next)
  }, [])

  const value = useMemo<LayoutValue>(() => {
    const terminalCount: TerminalCount = layout === 4 ? 4 : 6
    return {
      layout,
      setLayout,
      isJobs: layout === 'jobs',
      terminalCount,
      agentColumns: terminalCount === 6 ? 3 : 2,
      showRightColumn: layout === 4
    }
  }, [layout, setLayout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLayout(): LayoutValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLayout must be used inside LayoutProvider')
  return ctx
}

/**
 * The agents the current layout has room for, in sort order. Memoised —
 * consumers key effects off this array's identity.
 */
export function useVisibleAgents(): AgentConfig[] {
  const { agents } = useAgentsState()
  const { terminalCount } = useLayout()
  return useMemo(
    () => (agents.length <= terminalCount ? agents : agents.slice(0, terminalCount)),
    [agents, terminalCount]
  )
}
