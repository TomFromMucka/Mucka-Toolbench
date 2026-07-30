import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentConfig } from '@shared/types'
import { useAgentsState } from './AgentsContext'

/**
 * How many agent terminals the cockpit shows. Six only fits by giving up
 * the right column (previews, Vercel, git), so the count drives the whole
 * top-level layout rather than just the agent grid.
 */
export type TerminalCount = 4 | 6

const STORAGE_KEY = 'layout.terminalCount'

interface LayoutValue {
  terminalCount: TerminalCount
  setTerminalCount: (next: TerminalCount) => void
  /** Agent-grid columns — each column is a stack of two clipboards. */
  agentColumns: 2 | 3
  /** False in 6-up: browser previews, Vercel and git are hidden. */
  showRightColumn: boolean
}

const Ctx = createContext<LayoutValue | null>(null)

function readCount(): TerminalCount {
  try {
    return localStorage.getItem(STORAGE_KEY) === '6' ? 6 : 4
  } catch {
    return 4
  }
}

export function LayoutProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [terminalCount, setCount] = useState<TerminalCount>(readCount)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(terminalCount))
    } catch {
      /* storage disabled */
    }
  }, [terminalCount])

  const setTerminalCount = useCallback((next: TerminalCount) => {
    setCount(next)
  }, [])

  const value = useMemo<LayoutValue>(
    () => ({
      terminalCount,
      setTerminalCount,
      agentColumns: terminalCount === 6 ? 3 : 2,
      showRightColumn: terminalCount === 4
    }),
    [terminalCount, setTerminalCount]
  )

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
