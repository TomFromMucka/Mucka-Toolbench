import { createContext, useContext } from 'react'
import { useNotes } from '../hooks/useNotes'

type NotesValue = ReturnType<typeof useNotes>

const Ctx = createContext<NotesValue | null>(null)

export function NotesProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const value = useNotes()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotesState(): NotesValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotesState must be used inside NotesProvider')
  return ctx
}
