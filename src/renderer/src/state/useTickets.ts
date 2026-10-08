import { useEffect, useState } from 'react'
import type { TicketsState } from '@shared/types'

/** The watcher's ticket list, live. Null until the first answer. */
export function useTickets(): TicketsState | null {
  const [state, setState] = useState<TicketsState | null>(null)
  useEffect(() => {
    void window.mucka?.listTickets().then(setState)
    return window.mucka?.onTicketsUpdate(setState)
  }, [])
  return state
}
