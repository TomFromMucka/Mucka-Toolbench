import { createContext, useContext } from 'react'
import { useNotices } from '../hooks/useNotices'

type NoticesValue = ReturnType<typeof useNotices>

const Ctx = createContext<NoticesValue | null>(null)

export function NoticesProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useNotices()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNoticesState(): NoticesValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNoticesState must be used inside NoticesProvider')
  return ctx
}
