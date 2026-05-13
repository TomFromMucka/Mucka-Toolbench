import { useEffect, useState } from 'react'
import type { AgentId, GitStatus } from '@shared/types'

export type GitStatusMap = Partial<Record<AgentId, GitStatus>>

/**
 * Subscribes to git:status events from main and returns the latest
 * status per agent. Push-only — main polls; renderer just listens.
 */
export function useGitStatus(): GitStatusMap {
  const [map, setMap] = useState<GitStatusMap>({})

  useEffect(() => {
    const off = window.mucka.onGitStatus(({ agentId, status }) => {
      setMap((prev) => ({ ...prev, [agentId]: status }))
    })
    return off
  }, [])

  return map
}
