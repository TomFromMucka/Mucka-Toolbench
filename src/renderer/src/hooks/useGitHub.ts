import { useCallback, useEffect, useState } from 'react'
import type {
  AgentId,
  GitHubAgentSummary,
  GitHubStatus
} from '@shared/types'

export type GitHubMap = Partial<Record<AgentId, GitHubAgentSummary>>

interface UseGitHubResult {
  status: GitHubStatus | null
  summaries: GitHubMap
  refresh: (agentId: AgentId) => Promise<void>
}

/**
 * Loads the initial GitHub snapshot from main, then subscribes to live
 * github:update events. Main owns the polling cadence.
 */
export function useGitHub(): UseGitHubResult {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [summaries, setSummaries] = useState<GitHubMap>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, all] = await Promise.all([
        window.mucka.getGitHubStatus(),
        window.mucka.listAllGitHubSummaries()
      ])
      if (cancelled) return
      setStatus(s)
      setSummaries(all)
    })()
    const off = window.mucka.onGitHubUpdate(({ agentId, summary }) => {
      setSummaries((prev) => ({ ...prev, [agentId]: summary }))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const refresh = useCallback(async (agentId: AgentId) => {
    const summary = await window.mucka.refreshGitHub(agentId)
    setSummaries((prev) => ({ ...prev, [agentId]: summary }))
  }, [])

  return { status, summaries, refresh }
}
