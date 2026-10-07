import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  AgentId,
  PendingAnswer,
  PendingAnswerResult,
  PendingItem,
  TerminalId
} from '@shared/types'
import { useAgentStatuses } from './AgentStatusContext'
import { useVisibleAgents } from './LayoutContext'

/**
 * One agent waiting on Tom, in the order he should deal with them.
 *
 * Agents blocked on a prompt or a question come first, oldest first,
 * because a blocked agent is a wasted seat. Agents that are only flagged,
 * or idle waiting for their next instruction, follow in seat order.
 */
export interface QueueEntry {
  agentId: AgentId
  /** Where to jump to. Null when the agent is flagged but not blocked. */
  terminalId: TerminalId | null
  /** What it's blocked on. Null when it's only waiting for its next prompt. */
  pending: PendingItem | null
}

interface NeedsYouValue {
  queue: QueueEntry[]
  /** 1-based place in the queue, or null when the agent isn't waiting. */
  placeOf: (agentId: AgentId) => number | null
  answer: (answer: PendingAnswer) => Promise<PendingAnswerResult>
  /** Bring a terminal forward: switch to its split tab and focus it. */
  focusTerminal: (terminalId: TerminalId) => void
}

const FOCUS_EVENT = 'mucka:focus-terminal'

const Ctx = createContext<NeedsYouValue | null>(null)

export function NeedsYouProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [pending, setPending] = useState<PendingItem[]>([])
  const agents = useVisibleAgents()
  const { statusFor } = useAgentStatuses()

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    let alive = true
    void api.listPending().then((items) => {
      if (alive) setPending(items)
    })
    const off = api.onPendingUpdate((items) => setPending(items))
    return () => {
      alive = false
      off()
    }
  }, [])

  const queue = useMemo<QueueEntry[]>(() => {
    const visible = new Set(agents.map((a) => a.id))
    const blocked = pending
      .filter((p) => visible.has(p.agentId))
      .map((p) => ({ agentId: p.agentId, terminalId: p.terminalId, pending: p }))
    const blockedIds = new Set(blocked.map((b) => b.agentId))
    const waiting = agents
      .filter(
        (a) =>
          a.running &&
          !blockedIds.has(a.id) &&
          (a.needsAttention ||
            statusFor(a.id) === 'awaiting-input' ||
            statusFor(a.id) === 'blocked')
      )
      .map((a) => ({ agentId: a.id, terminalId: a.id, pending: null }))
    return [...blocked, ...waiting]
  }, [pending, agents, statusFor])

  const placeOf = useCallback(
    (agentId: AgentId): number | null => {
      const i = queue.findIndex((e) => e.agentId === agentId)
      return i === -1 ? null : i + 1
    },
    [queue]
  )

  const answer = useCallback(async (a: PendingAnswer): Promise<PendingAnswerResult> => {
    const result = await window.mucka.answerPending(a)
    // The hook clears its file once Claude has the answer, and the watcher
    // pushes the new list. Drop the card now so a second click can't land.
    if (result.ok) setPending((prev) => prev.filter((p) => p.id !== a.id))
    return result
  }, [])

  const focusTerminal = useCallback((terminalId: TerminalId): void => {
    window.dispatchEvent(new CustomEvent<TerminalId>(FOCUS_EVENT, { detail: terminalId }))
  }, [])

  const value = useMemo<NeedsYouValue>(
    () => ({ queue, placeOf, answer, focusTerminal }),
    [queue, placeOf, answer, focusTerminal]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNeedsYou(): NeedsYouValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNeedsYou must be used inside NeedsYouProvider')
  return ctx
}

/** Run `handler` whenever something asks for `terminalId` to be brought forward. */
export function useFocusRequests(handler: (terminalId: TerminalId) => void): void {
  useEffect(() => {
    const listener = (e: Event): void => {
      if (!(e instanceof CustomEvent)) return
      const detail: unknown = e.detail
      if (typeof detail === 'string') handler(detail)
    }
    window.addEventListener(FOCUS_EVENT, listener)
    return () => window.removeEventListener(FOCUS_EVENT, listener)
  }, [handler])
}
