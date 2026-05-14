import { createContext, useContext } from 'react'
import { useVercel } from '../hooks/useVercel'

type VercelValue = ReturnType<typeof useVercel>

const Ctx = createContext<VercelValue | null>(null)

export function VercelProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useVercel()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVercelState(): VercelValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVercelState must be used inside VercelProvider')
  return ctx
}
