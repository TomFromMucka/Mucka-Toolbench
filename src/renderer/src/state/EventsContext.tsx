import { createContext, useContext } from 'react'
import { useEvents } from '../hooks/useEvents'

type EventsValue = ReturnType<typeof useEvents>

const Ctx = createContext<EventsValue | null>(null)

export function EventsProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useEvents()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEventsState(): EventsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEventsState must be used inside EventsProvider')
  return ctx
}
