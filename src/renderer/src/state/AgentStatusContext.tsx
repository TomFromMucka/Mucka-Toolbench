import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentId, AgentStatus, AgentStatusEvent } from '@shared/types'

type StatusMap = Partial<Record<AgentId, AgentStatus>>

interface AgentStatusValue {
  statuses: StatusMap
  statusFor: (agentId: AgentId) => AgentStatus
}

const Ctx = createContext<AgentStatusValue | null>(null)

export function AgentStatusProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [statuses, setStatuses] = useState<StatusMap>({})

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    return api.onAgentStatus((event: AgentStatusEvent) => {
      setStatuses((prev) => {
        if (prev[event.agentId] === event.status) return prev
        return { ...prev, [event.agentId]: event.status }
      })
    })
  }, [])

  const value = useMemo<AgentStatusValue>(
    () => ({
      statuses,
      statusFor: (agentId: AgentId): AgentStatus => statuses[agentId] ?? 'idle'
    }),
    [statuses]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentStatuses(): AgentStatusValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAgentStatuses must be used inside AgentStatusProvider')
  return ctx
}
