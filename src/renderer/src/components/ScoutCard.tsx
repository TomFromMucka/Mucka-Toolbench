import { useState } from 'react'
import type { Ticket } from '@shared/types'

/**
 * A ticket on the board's Scouting column: a read-only scout is reading
 * it, or has written its brief and it's waiting for Tom to start a fix.
 */
export function ScoutCard({
  ticket,
  onOpen,
  onStarted
}: {
  ticket: Ticket
  /** Open the ticket, on its brief when there is one. */
  onOpen: () => void
  onStarted: (jobId: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = ticket.briefState

  const startFix = (): void => {
    setBusy(true)
    setError(null)
    window.mucka
      .startTicketJob(ticket.reference)
      .then((job) => onStarted(job.id))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className="chamfer-sm flex cursor-pointer flex-col gap-1 px-2.5 py-2 text-left"
      style={{ background: 'var(--surface2)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
    >
      <span className="flex items-center gap-1.5">
        <span className="t-label-sm text-dirty-grey">Scout · {ticket.reference}</span>
        <span
          className={`t-body-sm ml-auto ${state === 'failed' ? 'text-status-bad' : state === 'ready' ? 'text-van-white' : 'text-dirty-grey'}`}
        >
          {state === 'queued'
            ? 'queued'
            : state === 'running'
              ? 'scouting…'
              : state === 'ready'
                ? 'brief ready'
                : 'failed'}
        </span>
      </span>
      <span className="t-body-sm line-clamp-2 text-van-white">{ticket.subject}</span>
      {ticket.business ? (
        <span className="t-body-sm truncate text-dirty-grey">{ticket.business}</span>
      ) : null}
      {state === 'failed' && ticket.briefError ? (
        <span className="t-body-sm line-clamp-2 text-status-bad">{ticket.briefError}</span>
      ) : null}
      {error ? <span className="t-body-sm text-status-bad">{error}</span> : null}
      {state === 'ready' || state === 'failed' ? (
        <span className="t-body-sm flex flex-wrap gap-x-2 pt-0.5">
          {state === 'ready' ? (
            <CardLink disabled={busy} onClick={startFix}>
              {busy ? 'starting…' : '▶ start fix'}
            </CardLink>
          ) : (
            <CardLink onClick={() => void window.mucka.scoutTicket(ticket.reference)}>
              ↻ scout again
            </CardLink>
          )}
          <CardLink onClick={() => void window.mucka.dismissScout(ticket.reference)} dim>
            dismiss
          </CardLink>
          {ticket.briefCost !== null ? (
            <span className="ml-auto text-dirty-grey">${ticket.briefCost.toFixed(2)}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

function CardLink({
  children,
  onClick,
  disabled,
  dim = false
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  dim?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`hover:underline disabled:opacity-50 ${dim ? 'text-dirty-grey' : 'text-van-white'}`}
    >
      {children}
    </button>
  )
}
