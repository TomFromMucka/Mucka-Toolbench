import { useState } from 'react'
import type { Job } from '@shared/types'
import { TermButton } from './IntakeBits'
import { THEME } from './terminalTheme'

/** Notes survive closing the view by accident. */
const notes = new Map<string, string>()

/**
 * Start a job on a ticket or issue, with an optional note from Tom that
 * goes first in its opening message. Once it has a job, this becomes the
 * way to it.
 */
export function JobStarter({
  label,
  jobId,
  onOpenJob,
  onStart,
  onStarted
}: {
  /** What the note belongs to, e.g. TKT-1481 or MUCKA-WEB-C5. */
  label: string
  jobId: string | null
  onOpenJob: (jobId: string) => void
  onStart: (note: string | undefined) => Promise<Job>
  onStarted: (jobId: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState(() => notes.get(label) ?? '')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (jobId) {
    return (
      <div
        className="flex items-baseline gap-2 px-4 py-2"
        style={{ borderBottom: `1px solid ${THEME.black}` }}
      >
        <span style={{ color: 'var(--dirty-grey)' }}>This has a job.</span>
        <TermButton onClick={() => onOpenJob(jobId)}>→ open its job</TermButton>
      </div>
    )
  }

  const edit = (text: string): void => {
    setNote(text)
    if (text) notes.set(label, text)
    else notes.delete(label)
  }

  const start = (): void => {
    setStarting(true)
    setError(null)
    onStart(note.trim() || undefined)
      .then((job) => {
        notes.delete(label)
        onStarted(job.id)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setStarting(false))
  }

  return (
    <div
      className="flex flex-col gap-1 px-4 py-2"
      style={{ borderBottom: `1px solid ${THEME.black}` }}
    >
      <div className="flex items-start gap-2">
        <textarea
          value={note}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey && !starting) {
              e.preventDefault()
              start()
            }
          }}
          rows={2}
          placeholder="Note for the job (optional): any direction before it starts… ⌘↵ to start"
          className="min-w-0 flex-1 resize-y px-2 py-1 outline-none placeholder:text-[var(--dirty-grey)]"
          style={{ fontFamily: 'inherit', background: THEME.black, color: THEME.foreground }}
        />
        <TermButton
          disabled={starting}
          onClick={start}
          title="A fresh job that reads this, does the groundwork and drafts the fix, with your note first"
        >
          {starting ? 'starting…' : '▶ start job'}
        </TermButton>
      </div>
      {error ? <span style={{ color: THEME.brightRed }}>{error}</span> : null}
    </div>
  )
}
