import { useEffect, useRef } from 'react'
import { useAgentsState } from './AgentsContext'
import { playAttentionChime } from '../mucka/chime'

/**
 * Watches the agent list for `needsAttention` rising edges. On any rise
 * (an agent newly flagged), plays the attention chime. On every change,
 * pushes the current count to the dock badge / window flash via main.
 *
 * Renders nothing; mount once near the top of the tree.
 */
export function AttentionNotifier(): null {
  const { agents } = useAgentsState()
  const prevSetRef = useRef<Set<string>>(new Set())
  const hydratedRef = useRef(false)

  useEffect(() => {
    const flagged = new Set(agents.filter((a) => a.needsAttention).map((a) => a.id))

    if (!hydratedRef.current) {
      // First render — adopt the current set without chiming, so we don't
      // beep just because the cockpit booted with a prior attention flag
      // still in the db.
      prevSetRef.current = flagged
      hydratedRef.current = true
      window.mucka?.notifyAttention(flagged.size)
      return
    }

    const prev = prevSetRef.current
    let rose = false
    for (const id of flagged) {
      if (!prev.has(id)) {
        rose = true
        break
      }
    }

    if (rose) playAttentionChime()
    if (flagged.size !== prev.size || rose) {
      window.mucka?.notifyAttention(flagged.size)
    }
    prevSetRef.current = flagged
  }, [agents])

  return null
}
