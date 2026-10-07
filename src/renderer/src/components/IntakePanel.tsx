import { useCallback, useEffect, useState } from 'react'
import type { Job, SentryHealth, SentryIssue, SentryStatus } from '@shared/types'
import { useJobs } from '../state/JobsContext'
import { Clipboard } from './Clipboard'
import { TERMINAL_FONT, THEME } from './terminalTheme'

/**
 * Work coming in, before it's a job. Sentry first (the poller already
 * keeps the unresolved list); support tickets join it later. Each item
 * can start a job whose Claude opens already briefed on it.
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

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

/** Claude's opening message for a job started from a Sentry issue. */
function sentryBrief(issue: SentryIssue): string {
  return [
    `Sentry issue ${issue.shortId} in ${issue.project}: ${issue.title}`,
    issue.detail ? `Message: ${issue.detail}` : null,
    issue.culprit ? `Where: ${issue.culprit}` : null,
    `${issue.count} events, ${issue.userCount} users affected. First seen ${day(issue.firstSeen)}, last seen ${day(issue.lastSeen)} (UTC).`,
    issue.permalink,
    '',
    'Do the groundwork in docs/sentry-groundwork-rules.md: read the issue and its latest events, find the cause, and reproduce it with a failing test before changing anything.',
    'Once a failing test reproduces it, draft the fix, unless it touches payments, migrations, permissions or voice. For those, stop at the evidence and tell me.',
    'When you need a decision from me, ask with AskUserQuestion.'
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
}

const sourceOf = (issue: SentryIssue): string => `sentry:${issue.shortId}`

export function IntakePanel({
  onSelect
}: {
  /** Show a job on the board and in the terminal column. */
  onSelect: (jobId: string) => void
}): React.JSX.Element {
  const { jobs, createJob } = useJobs()
  const [issues, setIssues] = useState<SentryIssue[]>([])
  const [status, setStatus] = useState<SentryStatus | null>(null)
  const [health, setHealth] = useState<SentryHealth | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback((): Promise<void> => {
    const api = window.mucka
    if (!api) return Promise.resolve()
    return api.getSentryStatus().then(async (s) => {
      setStatus(s)
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
    return () => {
      clearInterval(timer)
      off?.()
    }
  }, [load])

  const start = async (issue: SentryIssue): Promise<void> => {
    setStarting(issue.id)
    setError(null)
    try {
      const job = await createJob({
        title: `${issue.shortId}: ${issue.title}`,
        prompt: sentryBrief(issue),
        source: sourceOf(issue)
      })
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
    <Clipboard title="Intake" subtitle={error ?? 'Sentry · unresolved'} bodyClassName="min-h-0">
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
        {issues.length === 0 ? (
          <span className="px-3 py-3" style={{ color: 'var(--dirty-grey)' }}>
            {empty}
          </span>
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
