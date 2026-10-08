import { useCallback, useEffect, useState } from 'react'
import type {
  Job,
  JobsAutoStatus,
  SentryHealth,
  SentryIssue,
  SentryStatus,
  Ticket,
  TicketsState
} from '@shared/types'
import { useJobs } from '../state/JobsContext'
import { Clipboard } from './Clipboard'
import { TERMINAL_FONT, THEME } from './terminalTheme'

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

function ago(ms: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ms) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

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
    const offTickets = window.mucka?.onTicketsUpdate(setTickets)
    return () => {
      clearInterval(timer)
      off?.()
      offJobs?.()
      offTickets?.()
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
          <>
            {tickets?.error ? <Dim error>{tickets.error}</Dim> : null}
            {tickets === null ? (
              <Dim>Loading…</Dim>
            ) : tickets.tickets.length === 0 && !tickets.error ? (
              <Dim>{tickets.polledAt ? 'No open tickets.' : 'Looking at the ticket list…'}</Dim>
            ) : (
              tickets.tickets.map((t) => <TicketRow key={t.reference} ticket={t} now={now} />)
            )}
          </>
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

function Dim({
  children,
  error = false
}: {
  children: React.ReactNode
  error?: boolean
}): React.JSX.Element {
  return (
    <span className="px-3 py-2" style={{ color: error ? THEME.brightRed : 'var(--dirty-grey)' }}>
      {children}
    </span>
  )
}

/**
 * One open ticket. The brief comes from the read-only scout; Tom reads it
 * here rather than the customer's own text.
 */
function TicketRow({ ticket, now }: { ticket: Ticket; now: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const scout = (): void => void window.mucka.scoutTicket(ticket.reference)
  const who = [ticket.business, ticket.category].filter(Boolean).join(' · ')
  return (
    <div
      className="flex flex-col gap-0.5 px-3 py-2.5"
      style={{ borderBottom: `1px solid ${THEME.black}` }}
    >
      <div className="flex items-baseline gap-2">
        <span style={{ fontWeight: 700 }}>{ticket.reference}</span>
        <span style={{ color: ticket.status === 'open' ? THEME.yellow : 'var(--dirty-grey)' }}>
          {ticket.status.replace('_', ' ')}
        </span>
        <span className="ml-auto shrink-0" style={{ color: 'var(--dirty-grey)' }}>
          {ago(ticket.updatedAt, now)}
        </span>
      </div>
      <span className="line-clamp-2 break-words">{ticket.subject}</span>
      {who ? (
        <span className="truncate" style={{ color: 'var(--dirty-grey)' }}>
          {who}
        </span>
      ) : null}
      <div className="mt-1 flex gap-1">
        {ticket.briefState === 'ready' ? (
          <TermButton onClick={() => setOpen((v) => !v)}>{open ? '▾ brief' : '▸ brief'}</TermButton>
        ) : ticket.briefState === 'queued' || ticket.briefState === 'running' ? (
          <span className="px-1.5" style={{ color: 'var(--dirty-grey)' }}>
            {ticket.briefState === 'running' ? 'scouting…' : 'queued for the scout'}
          </span>
        ) : (
          <TermButton
            onClick={scout}
            title="A read-only Claude reads the ticket and the code, and writes a brief"
          >
            {ticket.briefState === 'failed' ? '↻ scout again' : '▶ scout'}
          </TermButton>
        )}
        {ticket.briefState === 'ready' ? (
          <TermButton onClick={scout} title="Write the brief again from the ticket as it is now">
            ↻
          </TermButton>
        ) : null}
        {ticket.briefCost !== null ? (
          <span className="ml-auto px-1.5" style={{ color: 'var(--dirty-grey)' }}>
            ${ticket.briefCost.toFixed(2)}
          </span>
        ) : null}
      </div>
      {ticket.briefState === 'failed' && ticket.briefError ? (
        <span style={{ color: THEME.brightRed }}>{ticket.briefError}</span>
      ) : null}
      {open && ticket.brief ? (
        <pre
          className="mt-1 whitespace-pre-wrap break-words px-2 py-1.5"
          style={{ background: THEME.black, fontFamily: 'inherit' }}
        >
          {ticket.brief}
        </pre>
      ) : null}
    </div>
  )
}

function TermButton({
  children,
  onClick,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-1.5 text-left hover:bg-[rgba(234,233,232,0.1)] disabled:opacity-50"
      style={{ fontFamily: 'inherit', color: THEME.brightWhite }}
    >
      [ {children} ]
    </button>
  )
}
