import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { SentryIssue } from '@shared/types'
import { useJobs } from '../state/JobsContext'
import { TermButton } from './IntakeBits'
import { when } from './intakeFormat'
import { JobStarter } from './JobStarter'
import { TERMINAL_FONT, THEME } from './terminalTheme'

const DIM = 'var(--dirty-grey)'

/**
 * A Sentry issue opened from Intake: what it is, and starting a job on it
 * with a note, the same way a ticket starts one.
 */
export function SentryModal({
  issue,
  onClose,
  onJob
}: {
  issue: SentryIssue
  onClose: () => void
  onJob: (jobId: string) => void
}): React.JSX.Element {
  const { jobs } = useJobs()
  const job = jobs.find((j) => j.source === `sentry:${issue.shortId}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = (jobId: string): void => {
    onJob(jobId)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.6)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-[min(760px,94vw)] flex-col"
        style={{
          background: THEME.background,
          color: THEME.foreground,
          fontFamily: TERMINAL_FONT,
          fontSize: 12.5,
          lineHeight: 1.5,
          boxShadow: `0 0 0 1px ${THEME.brightBlack}, 0 20px 60px rgba(0,0,0,0.5)`
        }}
      >
        <header
          className="flex items-baseline gap-2 px-4 py-2.5"
          style={{ borderBottom: `1px solid ${THEME.black}` }}
        >
          <span style={{ fontWeight: 700 }}>{issue.shortId}</span>
          <span
            style={{
              color:
                issue.level === 'fatal' || issue.level === 'error' ? THEME.brightRed : THEME.yellow
            }}
          >
            {issue.level}
          </span>
          <span style={{ color: DIM }}>{issue.project}</span>
          <span className="ml-auto" />
          <a
            href={issue.permalink}
            target="_blank"
            rel="noreferrer"
            className="px-1.5 hover:bg-[rgba(234,233,232,0.1)]"
            style={{ color: DIM }}
          >
            sentry ↗
          </a>
          <TermButton tone="dim" onClick={onClose} title="Close (Esc)">
            × close
          </TermButton>
        </header>

        <JobStarter
          label={issue.shortId}
          jobId={job?.id ?? null}
          onOpenJob={go}
          onStart={(note) => window.mucka.startSentryJob(issue.id, note)}
          onStarted={go}
        />

        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-4 py-3">
          <div className="break-words" style={{ fontWeight: 700, fontSize: 14 }}>
            {issue.title}
          </div>
          {issue.detail ? (
            <div className="whitespace-pre-wrap break-words">{issue.detail}</div>
          ) : null}
          {issue.culprit ? <div style={{ color: DIM }}>at {issue.culprit}</div> : null}
          <div style={{ color: DIM }}>
            {issue.count} event{issue.count === 1 ? '' : 's'} · {issue.userCount} user
            {issue.userCount === 1 ? '' : 's'}
            {issue.isUnhandled ? ' · unhandled' : ''}
            {issue.category ? ` · ${issue.category}` : ''}
          </div>
          <div style={{ color: DIM }}>
            first seen {when(issue.firstSeen)} · last seen {when(issue.lastSeen)}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
