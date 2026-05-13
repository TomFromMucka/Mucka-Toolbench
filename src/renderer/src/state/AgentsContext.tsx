import { createContext, useContext } from 'react'
import { useAgents } from '../hooks/useAgents'

type AgentsValue = ReturnType<typeof useAgents>

const Ctx = createContext<AgentsValue | null>(null)

export function AgentsProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useAgents()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentsState(): AgentsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAgentsState must be used inside AgentsProvider')
  return ctx
}
