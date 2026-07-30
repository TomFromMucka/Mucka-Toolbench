import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentId, AgentStatus, AgentStatusEvent } from '@shared/types'

type StatusMap = Partial<Record<AgentId, AgentStatus>>
type ContextMap = Partial<Record<AgentId, number | null>>
type ModelMap = Partial<Record<AgentId, string | null>>

interface AgentStatusValue {
  statuses: StatusMap
  contextUsedPercents: ContextMap
  models: ModelMap
  statusFor: (agentId: AgentId) => AgentStatus
  /** Percent of the context window consumed — see AgentStatusEvent. */
  contextUsedPercentFor: (agentId: AgentId) => number | null
  /** Model display name from the status line, e.g. "Opus 5 (1M context)". */
  modelFor: (agentId: AgentId) => string | null
}

const Ctx = createContext<AgentStatusValue | null>(null)

export function AgentStatusProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [statuses, setStatuses] = useState<StatusMap>({})
  const [contextUsedPercents, setContextUsedPercents] = useState<ContextMap>({})
  const [models, setModels] = useState<ModelMap>({})

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    return api.onAgentStatus((event: AgentStatusEvent) => {
      setStatuses((prev) =>
        prev[event.agentId] === event.status
          ? prev
          : { ...prev, [event.agentId]: event.status }
      )
      const nextCtx = event.contextUsedPercent ?? null
      setContextUsedPercents((prev) =>
        prev[event.agentId] === nextCtx
          ? prev
          : { ...prev, [event.agentId]: nextCtx }
      )
      const nextModel = event.model ?? null
      setModels((prev) =>
        prev[event.agentId] === nextModel
          ? prev
          : { ...prev, [event.agentId]: nextModel }
      )
    })
  }, [])

  const value = useMemo<AgentStatusValue>(
    () => ({
      statuses,
      contextUsedPercents,
      models,
      statusFor: (agentId: AgentId): AgentStatus => statuses[agentId] ?? 'idle',
      contextUsedPercentFor: (agentId: AgentId): number | null =>
        contextUsedPercents[agentId] ?? null,
      modelFor: (agentId: AgentId): string | null => models[agentId] ?? null
    }),
    [statuses, contextUsedPercents, models]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentStatuses(): AgentStatusValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAgentStatuses must be used inside AgentStatusProvider')
  return ctx
}
