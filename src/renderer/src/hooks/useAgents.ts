import { useCallback, useEffect, useState } from 'react'
import type { AgentConfig } from '@shared/types'

interface UseAgentsResult {
  agents: AgentConfig[]
  loading: boolean
  reload: () => Promise<void>
}

/** Live agent configs sourced from the main-process sqlite store. */
export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const list = await window.mucka.listAgents()
    setAgents(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { agents, loading, reload }
}

/**
 * Stable key that changes whenever an agent's spawn-affecting config changes.
 * Used as a React key on AgentTerminal so config edits cleanly remount and
 * respawn the PTY at the new cwd / command.
 */
export function spawnKey(agent: AgentConfig): string {
  return `${agent.id}::${agent.worktreePath}::${agent.command}::${agent.args.join('|')}`
}
