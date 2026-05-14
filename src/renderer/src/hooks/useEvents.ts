import { useEffect, useState } from 'react'
import type { JobEvent } from '@shared/types'

const MAX_KEEP = 200

interface UseEventsResult {
  events: JobEvent[]
  loading: boolean
}

/**
 * Live job-sheet feed. Loads the last 100 events on mount and prepends any
 * new ones that arrive via the `events:append` IPC event. Stored newest-first.
 */
export function useEvents(): UseEventsResult {
  const [events, setEvents] = useState<JobEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const initial = await window.mucka.listEvents(100)
      if (cancelled) return
      setEvents(initial)
      setLoading(false)
    })()

    const off = window.mucka.onEventAppend((event) => {
      setEvents((prev) => {
        const next = [event, ...prev]
        return next.length > MAX_KEEP ? next.slice(0, MAX_KEEP) : next
      })
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  return { events, loading }
}
