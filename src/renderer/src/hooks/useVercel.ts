import { useCallback, useEffect, useState } from 'react'
import type {
  AgentId,
  VercelAgentSummary,
  VercelStatus
} from '@shared/types'

export type VercelMap = Partial<Record<AgentId, VercelAgentSummary>>

interface UseVercelResult {
  status: VercelStatus | null
  summaries: VercelMap
  refresh: (agentId: AgentId) => Promise<void>
}

/**
 * Loads the initial Vercel snapshot from main, then subscribes to live
 * vercel:update events. Main owns the polling cadence; the renderer is
 * push-driven.
 */
export function useVercel(): UseVercelResult {
  const [status, setStatus] = useState<VercelStatus | null>(null)
  const [summaries, setSummaries] = useState<VercelMap>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, all] = await Promise.all([
        window.mucka.getVercelStatus(),
        window.mucka.listAllVercelDeployments()
      ])
      if (cancelled) return
      setStatus(s)
      setSummaries(all)
    })()
    const off = window.mucka.onVercelUpdate(({ agentId, summary }) => {
      setSummaries((prev) => ({ ...prev, [agentId]: summary }))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const refresh = useCallback(async (agentId: AgentId) => {
    const summary = await window.mucka.refreshVercel(agentId)
    setSummaries((prev) => ({ ...prev, [agentId]: summary }))
  }, [])

  return { status, summaries, refresh }
}
