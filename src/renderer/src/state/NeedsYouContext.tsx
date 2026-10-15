import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  AgentId,
  GitStatus,
  JobId,
  PendingAnswer,
  PendingAnswerResult,
  PendingItem,
  TerminalId
} from '@shared/types'
import { useGitStatus } from '../hooks/useGitStatus'
import { useAgentStatuses } from './AgentStatusContext'
import { useGitHubState } from './GitHubContext'
import { useJobs } from './JobsContext'
import { useVisibleAgents } from './LayoutContext'

/**
 * One agent or job waiting on Tom, in the order he should deal with them.
 *
 * Anything blocked on a prompt or a question comes first, oldest first,
 * because a blocked Claude is wasted time. Then anything flagged or asking
 * outside the hook, then everything that has finished a turn and needs his
 * next move: a job he has spoken to, or a worktree that has started.
 * Waiting on you and Check it used to be two lanes, split by whether
 * Claude Code's one-minute "waiting for your input" nudge happened to
 * fire; Tom's call (2026-10-12) was one queue, blocked first.
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

/**
 * Whether a worktree has started on something, so a Claude that has gone
 * quiet in it is waiting on Tom rather than idle. A branch of its own
 * counts even with nothing left on it: a merged PR still needs Finish to
 * park it. Only a worktree on its slot (or main) with nothing on it is
 * Idle, which is where Finish leaves it.
 */
function hasStarted(git: GitStatus | undefined, openPr: boolean): boolean {
  if (!git) return openPr
  const changed = git.modified + git.staged + git.untracked
  const branch = git.branch
  const ownBranch =
    branch !== null && branch !== 'main' && branch !== 'master' && !branch.startsWith('slot/')
  return changed > 0 || git.ahead > 0 || openPr || ownBranch
}

const Ctx = createContext<NeedsYouValue | null>(null)

export function NeedsYouProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [pending, setPending] = useState<PendingItem[]>([])
  const agents = useVisibleAgents()
  const { statusFor } = useAgentStatuses()
  const { jobs, jobStatusFor } = useJobs()
  const gitStatus = useGitStatus()
  const { summaries } = useGitHubState()
  // Git status re-arrives on every poll; key on the answer so the queue
  // only rebuilds when an agent starts or goes back to its slot.
  const startedKey = agents
    .filter((a) => hasStarted(gitStatus[a.id], Boolean(summaries[a.id]?.openPr)))
    .map((a) => a.id)
    .join(',')

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
    // Waiting on you is the active work. Anything Tom has put on hold, or a
    // job on its way off the board, sits in On hold or Idle and stays out of
    // the queue even when its Claude asks something: he's parked it.
    const activeAgents = agents.filter((a) => !a.held)
    const visible = new Set<string>(activeAgents.map((a) => a.id))
    const started = new Set(startedKey.split(','))
    const activeJobs = jobs.filter((j) => !j.held && j.state !== 'finished')
    const openJobs = new Set<string>(activeJobs.map((j) => j.id))
    const blocked: QueueEntry[] = []
    // One entry per agent or job: a second prompt from the same one (a
    // sub-agent's, say) would repeat its key, and React can't keep two
    // cards with one key apart. `pending` is oldest first, so the oldest wins.
    const seen = new Set<string>()
    for (const p of pending) {
      const owner = p.agentId ?? p.jobId
      if (!owner || seen.has(owner)) continue
      seen.add(owner)
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
    const asking = (s: string): boolean => s === 'awaiting-input' || s === 'blocked'
    const askingEntries: QueueEntry[] = []
    const finishedEntries: QueueEntry[] = []
    for (const j of activeJobs) {
      if (blockedKeys.has(j.id)) continue
      const entry = {
        key: j.id,
        agentId: null,
        jobId: j.id,
        terminalId: j.terminalId,
        pending: null
      }
      if (j.state === 'failed') finishedEntries.push(entry)
      if (j.state !== 'ready') continue
      const status = jobStatusFor(j.id)
      if (asking(status)) askingEntries.push(entry)
      // A job nobody has spoken to yet hasn't finished anything.
      else if (status === 'idle' && j.title !== 'New job') finishedEntries.push(entry)
    }
    for (const a of activeAgents) {
      if (!a.running || blockedKeys.has(a.id)) continue
      const entry = { key: a.id, agentId: a.id, jobId: null, terminalId: a.id, pending: null }
      const status = statusFor(a.id)
      if (a.needsAttention || asking(status)) askingEntries.push(entry)
      else if (status === 'idle' && started.has(a.id)) finishedEntries.push(entry)
    }
    return [...blocked, ...askingEntries, ...finishedEntries]
  }, [pending, agents, statusFor, jobs, jobStatusFor, startedKey])

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
