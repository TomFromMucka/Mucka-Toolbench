import { useState } from 'react'
import type { JobProposal } from '@shared/types'
import { Dim, TermButton } from './IntakeBits'
import { ago } from './intakeFormat'
import { JobStarter } from './JobStarter'
import { THEME } from './terminalTheme'

/**
 * Jobs that other jobs' Claudes proposed with `mucka-job.sh propose`. Each
 * opens to its brief, which is what the new job's Claude will start from,
 * so Tom reads it before pressing Start. Nothing here starts by itself.
 */
export function SpinoffsPane({
  proposals,
  now,
  onSelect
}: {
  proposals: JobProposal[]
  now: number
  onSelect: (jobId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (proposals.length === 0) {
    return <Dim>No spin-offs. A job&apos;s Claude proposes one when it finds work for a PR of its own.</Dim>
  }

  const dismiss = (id: string): void => {
    setError(null)
    window.mucka.dismissJobProposal(id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <>
      {error ? <Dim>{error}</Dim> : null}
      {proposals.map((p) => (
        <div key={p.id} className="flex flex-col" style={{ borderBottom: `1px solid ${THEME.black}` }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOpen(open === p.id ? null : p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setOpen(open === p.id ? null : p.id)
            }}
            className="flex cursor-pointer flex-col gap-0.5 px-3 py-2.5 hover:bg-[rgba(234,233,232,0.04)]"
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 break-words" style={{ fontWeight: 700 }}>
                {p.title}
              </span>
              <span className="shrink-0" style={{ color: 'var(--dirty-grey)' }}>
                {ago(p.createdAt, now)}
              </span>
            </div>
            <span className="truncate" style={{ color: 'var(--dirty-grey)' }}>
              from {p.parentTitle ?? p.parentJob}
            </span>
          </div>
          {open === p.id ? (
            <>
              <div
                className="whitespace-pre-wrap break-words px-4 pb-2"
                style={{ color: THEME.foreground }}
              >
                {p.brief}
              </div>
              <JobStarter
                label={p.id}
                jobId={null}
                onOpenJob={onSelect}
                onStart={(note) => window.mucka.startJobProposal(p.id, note)}
                onStarted={onSelect}
              />
              <div className="flex gap-1 px-4 pb-2.5">
                <TermButton tone="dim" onClick={() => dismiss(p.id)} title="Drop it. The job it came from isn't told.">
                  × dismiss
                </TermButton>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </>
  )
}
