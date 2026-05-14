import { createContext, useContext } from 'react'
import { useGitHub } from '../hooks/useGitHub'

type GitHubValue = ReturnType<typeof useGitHub>

const Ctx = createContext<GitHubValue | null>(null)

export function GitHubProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useGitHub()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGitHubState(): GitHubValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGitHubState must be used inside GitHubProvider')
  return ctx
}
