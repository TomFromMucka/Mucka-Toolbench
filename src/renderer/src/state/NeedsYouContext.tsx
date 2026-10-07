import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  AgentId,
  JobId,
  PendingAnswer,
  PendingAnswerResult,
  PendingItem,
  TerminalId
} from '@shared/types'
import { useAgentStatuses } from './AgentStatusContext'
import { useJobs } from './JobsContext'
import { useVisibleAgents } from './LayoutContext'

/**
 * One agent or job waiting on Tom, in the order he should deal with them.
 *
 * Anything blocked on a prompt or a question comes first, oldest first,
 * because a blocked Claude is wasted time. Agents and jobs that are only
 * flagged, or idle waiting for their next instruction, follow.
 */
export interface QueueEntry {
  /** The agent's or the job's id: whichever this entry is. */
  key: string
  agentId: AgentId | null
  jobId: JobId | null
  /** Where to jump to. */
  terminalId: TerminalId
  /** What it's blocked on. Null when it's only waiting for its next prompt. */
  pending: PendingItem | null
}

interface NeedsYouValue {
  queue: QueueEntry[]
  /** 1-based place in the queue of an agent or job id, or null when it isn't waiting. */
  placeOf: (id: string) => number | null
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
  const { jobs, jobStatusFor } = useJobs()

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
    const visible = new Set<string>(agents.map((a) => a.id))
    const openJobs = new Set<string>(jobs.map((j) => j.id))
    const blocked: QueueEntry[] = []
    for (const p of pending) {
      if (p.agentId && visible.has(p.agentId)) {
        blocked.push({
          key: p.agentId,
          agentId: p.agentId,
          jobId: null,
          terminalId: p.terminalId,
          pending: p
        })
      } else if (p.jobId && openJobs.has(p.jobId)) {
        blocked.push({
          key: p.jobId,
          agentId: null,
          jobId: p.jobId,
          terminalId: p.terminalId,
          pending: p
        })
      }
    }
    const blockedKeys = new Set(blocked.map((b) => b.key))
    const waitingStatus = (s: string): boolean => s === 'awaiting-input' || s === 'blocked'
    const waitingAgents: QueueEntry[] = agents
      .filter(
        (a) =>
          a.running &&
          !blockedKeys.has(a.id) &&
          (a.needsAttention || waitingStatus(statusFor(a.id)))
      )
      .map((a) => ({ key: a.id, agentId: a.id, jobId: null, terminalId: a.id, pending: null }))
    const waitingJobs: QueueEntry[] = jobs
      .filter(
        (j) => j.state === 'ready' && !blockedKeys.has(j.id) && waitingStatus(jobStatusFor(j.id))
      )
      .map((j) => ({
        key: j.id,
        agentId: null,
        jobId: j.id,
        terminalId: j.terminalId,
        pending: null
      }))
    return [...blocked, ...waitingJobs, ...waitingAgents]
  }, [pending, agents, statusFor, jobs, jobStatusFor])

  const placeOf = useCallback(
    (id: string): number | null => {
      const i = queue.findIndex((e) => e.key === id)
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
