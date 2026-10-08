import { useCallback, useEffect, useState } from 'react'
import type {
  Job,
  JobsAutoStatus,
  SentryHealth,
  SentryIssue,
  SentryStatus,
  TicketsState
} from '@shared/types'
import { useJobs } from '../state/JobsContext'
import { Clipboard } from './Clipboard'
import { Dim, TermButton } from './IntakeBits'
import { ago } from './intakeFormat'
import { TERMINAL_FONT, THEME } from './terminalTheme'
import { TicketsPane } from './TicketsPane'

/**
 * Work coming in, before it's a job. Sentry first (the poller already
 * keeps the unresolved list); support tickets join it later. Each item
 * can start a job whose Claude opens already briefed on it, and with
 * auto on, a Sentry issue Mucka rules a ticket starts one by itself
 * (JobManager caps how many are open and queues the rest).
 *
 * Styled like the terminal next to it, because that's where the work
 * goes: Tom reads it the way he'll read the job.
 */

const POLL_MS = 5 * 60_000

const sourceOf = (issue: SentryIssue): string => `sentry:${issue.shortId}`

type Tab = 'support' | 'sentry'
const TAB_KEY = 'mucka.intake.tab'

function savedTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'sentry' ? 'sentry' : 'support'
  } catch {
    return 'support'
  }
}

export function IntakePanel({
  onSelect
}: {
  /** Show a job on the board and in the terminal column. */
  onSelect: (jobId: string) => void
}): React.JSX.Element {
  const { jobs } = useJobs()
  const [auto, setAuto] = useState<JobsAutoStatus | null>(null)
  const [issues, setIssues] = useState<SentryIssue[]>([])
  const [status, setStatus] = useState<SentryStatus | null>(null)
  const [health, setHealth] = useState<SentryHealth | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tickets, setTickets] = useState<TicketsState | null>(null)
  const [tab, setTab] = useState<Tab>(savedTab)
  const pick = (next: Tab): void => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // Remembering the tab is a convenience; it can fail quietly.
    }
  }

  const load = useCallback((): Promise<void> => {
    const api = window.mucka
    if (!api) return Promise.resolve()
    return api.getSentryStatus().then(async (s) => {
      setStatus(s)
      setAuto(await api.getJobsAuto())
      if (s.kind !== 'ok') return
      const [list, h] = await Promise.all([api.listSentryIssues(), api.getSentryHealth()])
      setIssues([...list].sort((a, b) => b.lastSeen - a.lastSeen))
      setHealth(h)
      setNow(Date.now())
    })
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const off = window.mucka?.onSentryNewIssue(() => void load())
    // The queue moves when jobs open and close.
    const offJobs = window.mucka?.onJobsUpdate(() => void window.mucka.getJobsAuto().then(setAuto))
    void window.mucka?.listTickets().then(setTickets)
    const tick = setInterval(() => setNow(Date.now()), 60_000)
    const offTickets = window.mucka?.onTicketsUpdate(setTickets)
    return () => {
      clearInterval(timer)
      off?.()
      offJobs?.()
      offTickets?.()
      clearInterval(tick)
    }
  }, [load])

  const start = async (issue: SentryIssue): Promise<void> => {
    setStarting(issue.id)
    setError(null)
    try {
      const job = await window.mucka.startSentryJob(issue.id)
      onSelect(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(null)
    }
  }

  const jobFor = (issue: SentryIssue): Job | undefined =>
    jobs.find((j) => j.source === sourceOf(issue))

  const empty =
    status === null
      ? 'Loading…'
      : status.kind !== 'ok'
        ? "Sentry isn't connected. Add its token and organisation in Settings."
        : health && !health.hasPolled
          ? 'Waiting for the first look at Sentry…'
          : health?.lastError
            ? `Couldn't reach Sentry: ${health.lastError}`
            : 'Nothing unresolved in Sentry.'

  return (
    <Clipboard
      title="Intake"
      subtitle={error ?? 'support · sentry'}
      bodyClassName="min-h-0"
      rightSlot={
        auto ? (
          <button
            type="button"
            onClick={() => void window.mucka.setJobsAuto(!auto.enabled).then(setAuto)}
            className="px-1.5 hover:bg-[rgba(234,233,232,0.1)]"
            style={{ fontFamily: TERMINAL_FONT, fontSize: 11, color: 'var(--dirty-grey)' }}
            title={
              auto.enabled
                ? `Sentry issues Mucka rules a ticket start a job by themselves, ${auto.cap} open at most. Click to stop.`
                : 'Click to let Sentry tickets start jobs by themselves.'
            }
          >
            auto {auto.enabled ? 'on' : 'off'} · {auto.open}/{auto.cap}
            {auto.queued.length > 0 ? ` · ${auto.queued.length} queued` : ''}
          </button>
        ) : null
      }
    >
      <div
        className="flex h-full min-h-0 flex-col overflow-y-auto"
        style={{
          background: THEME.background,
          color: THEME.foreground,
          fontFamily: TERMINAL_FONT,
          fontSize: 12,
          lineHeight: 1.45
        }}
      >
        <div
          className="sticky top-0 z-10 flex gap-1 px-2 pt-2 pb-1"
          style={{ background: THEME.background }}
        >
          <TabButton active={tab === 'support'} onClick={() => pick('support')}>
            support {tickets ? tickets.tickets.length : '…'}
          </TabButton>
          <TabButton active={tab === 'sentry'} onClick={() => pick('sentry')}>
            sentry {status?.kind === 'ok' ? issues.length : '…'}
          </TabButton>
        </div>
        {tab === 'support' ? (
          <TicketsPane state={tickets} now={now} onSelect={onSelect} />
        ) : issues.length === 0 ? (
          <Dim>{empty}</Dim>
        ) : (
          issues.map((issue) => {
            const job = jobFor(issue)
            return (
              <div
                key={issue.id}
                className="flex flex-col gap-0.5 px-3 py-2.5"
                style={{ borderBottom: `1px solid ${THEME.black}` }}
              >
                <div className="flex items-baseline gap-2">
                  <span style={{ fontWeight: 700 }}>{issue.shortId}</span>
                  <span
                    style={{
                      color:
                        issue.level === 'fatal' || issue.level === 'error'
                          ? THEME.brightRed
                          : THEME.yellow
                    }}
                  >
                    {issue.level}
                  </span>
                  <span className="ml-auto shrink-0" style={{ color: 'var(--dirty-grey)' }}>
                    {ago(issue.lastSeen, now)}
                  </span>
                </div>
                <span className="line-clamp-2 break-words">{issue.title}</span>
                {issue.culprit ? (
                  <span className="truncate" style={{ color: 'var(--dirty-grey)' }}>
                    {issue.culprit}
                  </span>
                ) : null}
                <span style={{ color: 'var(--dirty-grey)' }}>
                  {issue.project} · {issue.count} event{issue.count === 1 ? '' : 's'} ·{' '}
                  {issue.userCount} user{issue.userCount === 1 ? '' : 's'}
                </span>
                <div className="mt-1 flex gap-1">
                  {job ? (
                    <TermButton onClick={() => onSelect(job.id)}>→ open its job</TermButton>
                  ) : auto?.queued.includes(issue.id) ? (
                    <TermButton
                      disabled={starting !== null}
                      onClick={() => void start(issue)}
                      title="Queued to start by itself when a place frees up. Click to start it now."
                    >
                      queued · start now
                    </TermButton>
                  ) : (
                    <TermButton
                      disabled={starting !== null}
                      onClick={() => void start(issue)}
                      title="A fresh job whose Claude opens with this issue and the groundwork rules"
                    >
                      {starting === issue.id ? 'starting…' : '▶ start job'}
                    </TermButton>
                  )}
                  <a
                    href={issue.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-1.5 hover:bg-[rgba(234,233,232,0.1)]"
                    style={{ color: 'var(--dirty-grey)' }}
                  >
                    sentry ↗
                  </a>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Clipboard>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-0.5 hover:bg-[rgba(234,233,232,0.1)]"
      style={{
        fontFamily: 'inherit',
        color: active ? THEME.brightWhite : 'var(--dirty-grey)',
        background: active ? THEME.black : undefined,
        fontWeight: active ? 700 : 400
      }}
    >
      {children}
    </button>
  )
}
