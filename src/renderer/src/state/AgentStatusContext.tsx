import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentId, AgentStatus, AgentStatusEvent } from '@shared/types'

type StatusMap = Partial<Record<AgentId, AgentStatus>>
type ContextMap = Partial<Record<AgentId, number | null>>

interface AgentStatusValue {
  statuses: StatusMap
  contextPercents: ContextMap
  statusFor: (agentId: AgentId) => AgentStatus
  contextPercentFor: (agentId: AgentId) => number | null
}

const Ctx = createContext<AgentStatusValue | null>(null)

export function AgentStatusProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [statuses, setStatuses] = useState<StatusMap>({})
  const [contextPercents, setContextPercents] = useState<ContextMap>({})

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    return api.onAgentStatus((event: AgentStatusEvent) => {
      setStatuses((prev) =>
        prev[event.agentId] === event.status
          ? prev
          : { ...prev, [event.agentId]: event.status }
      )
      const nextCtx = event.contextPercent ?? null
      setContextPercents((prev) =>
        prev[event.agentId] === nextCtx
          ? prev
          : { ...prev, [event.agentId]: nextCtx }
      )
    })
  }, [])

  const value = useMemo<AgentStatusValue>(
    () => ({
      statuses,
      contextPercents,
      statusFor: (agentId: AgentId): AgentStatus => statuses[agentId] ?? 'idle',
      contextPercentFor: (agentId: AgentId): number | null =>
        contextPercents[agentId] ?? null
    }),
    [statuses, contextPercents]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentStatuses(): AgentStatusValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAgentStatuses must be used inside AgentStatusProvider')
  return ctx
}
