import { useEffect, useMemo, useState } from 'react'
import type {
  Ticket,
  TicketCategoryFilter,
  TicketFilter,
  TicketStatusFilter,
  TicketsState
} from '@shared/types'
import { Dim, TermButton } from './IntakeBits'
import { ago, CATEGORY_LABELS, followUp, sortTickets, STATUS_LABELS } from './intakeFormat'
import { THEME } from './terminalTheme'
import { TicketModal } from './TicketModal'
import { prefetchTicket } from '../state/ticketCache'
import { useJobs } from '../state/JobsContext'

const STATUS_OPTIONS: { value: TicketStatusFilter; label: string }[] = [
  { value: 'active', label: 'active' },
  { value: 'all', label: 'all' },
  { value: 'awaiting_reply', label: 'awaiting reply' },
  { value: 'open', label: 'open' },
  { value: 'in_progress', label: 'in progress' },
  { value: 'resolved', label: 'resolved' },
  { value: 'closed', label: 'closed' }
]

const CATEGORY_OPTIONS: { value: TicketCategoryFilter; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'support', label: 'support' },
  { value: 'bug', label: 'bug' },
  { value: 'migration', label: 'migration' },
  { value: 'feature_request', label: 'feature request' }
]

const DEFAULT_FILTER: TicketFilter = { status: 'active', category: 'all', search: '' }
const isDefault = (f: TicketFilter): boolean =>
  f.status === 'active' && f.category === 'all' && f.search.trim() === ''

/**
 * Intake's support tab: /admin/support's list, filters and search. The
 * default view (active, every kind) is the watcher's live list; any other
 * filter asks ticket.ts on demand.
 */
export function TicketsPane({
  state,
  now,
  onSelect
}: {
  state: TicketsState | null
  now: number
  /** Show a job on the board and in the terminal column. */
  onSelect: (jobId: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<TicketFilter>(DEFAULT_FILTER)
  const [search, setSearch] = useState('')
  const [browsed, setBrowsed] = useState<Ticket[] | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [openRef, setOpenRef] = useState<string | null>(null)
  const { jobs } = useJobs()

  // Typing settles before it asks the database.
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => ({ ...f, search })), 350)
    return () => clearTimeout(timer)
  }, [search])

  const live = isDefault(filter)
  // The live list moves with every poll; a filtered look is refetched then too.
  const polledAt = state?.polledAt ?? null
  useEffect(() => {
    if (live) return
    let stale = false
    void window.mucka
      .browseTickets(filter)
      .then((rows) => {
        if (stale) return
        setBrowsed(rows)
        setBrowseError(null)
      })
      .catch((err: unknown) => {
        if (!stale) setBrowseError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [filter, live, polledAt])

  const rows = live ? (state?.tickets ?? null) : browsed
  const sorted = useMemo(() => (rows ? sortTickets(rows, now) : null), [rows, now])
  const grouped = filter.status === 'active'
  const error = live ? (state?.error ?? null) : browseError

  const set = (patch: Partial<TicketFilter>): void => {
    setBrowsed(null)
    setFilter((f) => ({ ...f, ...patch }))
  }

  const renderRows = (list: Ticket[]): React.ReactNode =>
    list.map((t) => (
      <TicketRow
        key={t.reference}
        ticket={t}
        now={now}
        jobId={jobs.find((j) => j.source === `ticket:${t.reference}`)?.id ?? null}
        onOpen={() => setOpenRef(t.reference)}
        onSelect={onSelect}
      />
    ))

  return (
    <>
      <div className="flex flex-col gap-1 px-3 pt-1 pb-2" style={{ color: 'var(--dirty-grey)' }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Select
            label="status"
            value={filter.status}
            options={STATUS_OPTIONS}
            onChange={(status) => set({ status })}
          />
          <Select
            label="kind"
            value={filter.category}
            options={CATEGORY_OPTIONS}
            onChange={(category) => set({ category })}
          />
          {!live || search ? (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                set(DEFAULT_FILTER)
              }}
              className="hover:underline"
              style={{ fontFamily: 'inherit', color: 'var(--dirty-grey)' }}
            >
              reset
            </button>
          ) : null}
        </div>
        <label className="flex items-center gap-1.5">
          <span style={{ color: THEME.green }}>❯</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search reference, subject, message, business, person"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--dirty-grey)]"
            style={{ fontFamily: 'inherit', color: THEME.foreground }}
          />
        </label>
      </div>

      {error ? <Dim error>{error}</Dim> : null}
      {sorted === null ? (
        <Dim>{live ? 'Looking at the ticket list…' : 'Searching…'}</Dim>
      ) : sorted.length === 0 ? (
        <Dim>{live ? 'Nothing open or in progress.' : 'No tickets match.'}</Dim>
      ) : grouped ? (
        <>
          <Group label="open · waiting on you" rows={sorted.filter((t) => t.status === 'open')}>
            {renderRows}
          </Group>
          <Group label="in progress" rows={sorted.filter((t) => t.status !== 'open')}>
            {renderRows}
          </Group>
        </>
      ) : (
        <>
          <Dim>
            {sorted.length} ticket{sorted.length === 1 ? '' : 's'}
          </Dim>
          {renderRows(sorted)}
        </>
      )}

      {openRef ? (
        <TicketModal
          reference={openRef}
          summary={rows?.find((t) => t.reference === openRef) ?? null}
          onClose={() => setOpenRef(null)}
          onJob={onSelect}
        />
      ) : null}
    </>
  )
}

function Group({
  label,
  rows,
  children
}: {
  label: string
  rows: Ticket[]
  children: (rows: Ticket[]) => React.ReactNode
}): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <>
      <div className="px-3 pt-2 pb-1" style={{ color: 'var(--dirty-grey)' }}>
        ── {label} · {rows.length} ──
      </div>
      {children(rows)}
    </>
  )
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value)
          if (next) onChange(next.value)
        }}
        className="cursor-pointer px-1 outline-none"
        style={{ fontFamily: 'inherit', background: THEME.black, color: THEME.brightWhite }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * One ticket. Clicking it opens the whole thing; the brief comes from the
 * read-only scout, and the badges are /admin/support's.
 */
function TicketRow({
  ticket,
  now,
  jobId,
  onOpen,
  onSelect
}: {
  ticket: Ticket
  now: number
  /** The fix job started from this ticket, if there is one. */
  jobId: string | null
  onOpen: () => void
  onSelect: (jobId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const startFix = (): void => {
    setStarting(true)
    setStartError(null)
    window.mucka
      .startTicketJob(ticket.reference)
      .then((job) => onSelect(job.id))
      .catch((err: unknown) => setStartError(err instanceof Error ? err.message : String(err)))
      .finally(() => setStarting(false))
  }
  const scout = (): void => void window.mucka.scoutTicket(ticket.reference)
  const due = followUp(ticket, now)
  const category = ticket.category ? CATEGORY_LABELS[ticket.category] : undefined
  const who = [ticket.business, ticket.raiser].filter(Boolean).join(' · ')
  const urgent = ticket.priority === 'high' || ticket.priority === 'urgent'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onMouseEnter={() => prefetchTicket(ticket.reference)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className="flex cursor-pointer flex-col gap-0.5 px-3 py-2.5 hover:bg-[rgba(234,233,232,0.04)]"
      style={{ borderBottom: `1px solid ${THEME.black}` }}
    >
      <div className="flex items-baseline gap-2">
        <span style={{ fontWeight: 700 }}>{ticket.reference}</span>
        <span style={{ color: ticket.status === 'open' ? THEME.yellow : 'var(--dirty-grey)' }}>
          {STATUS_LABELS[ticket.status] ?? ticket.status}
        </span>
        {category ? (
          <span style={{ color: ticket.category === 'bug' ? THEME.brightRed : THEME.blue }}>
            {category}
          </span>
        ) : null}
        {urgent ? <span style={{ color: THEME.brightRed }}>{ticket.priority}</span> : null}
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
      {ticket.awaitingReply || due || !ticket.customerVisible ? (
        <div className="flex flex-wrap gap-x-2">
          {ticket.awaitingReply ? (
            <span style={{ color: 'var(--orange)' }}>● awaiting reply</span>
          ) : null}
          {due ? (
            <span style={{ color: due.label === 'follow up' ? 'var(--orange)' : THEME.yellow }}>
              {due.label} · {due.days}d
            </span>
          ) : null}
          {!ticket.customerVisible ? (
            <span style={{ color: 'var(--dirty-grey)' }}>asked about · not visible to them</span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-1 flex items-baseline gap-1">
        {ticket.briefState === 'ready' ? (
          <TermButton onClick={() => setOpen((v) => !v)}>{open ? '▾ brief' : '▸ brief'}</TermButton>
        ) : ticket.briefState === 'queued' || ticket.briefState === 'running' ? (
          <span className="px-1.5" style={{ color: 'var(--dirty-grey)' }}>
            {ticket.briefState === 'running' ? 'scouting…' : 'queued for the scout'}
          </span>
        ) : ticket.status === 'open' || ticket.status === 'in_progress' ? (
          <TermButton
            onClick={scout}
            title="A read-only Claude reads the ticket and the code, and writes a brief"
          >
            {ticket.briefState === 'failed' ? '↻ scout again' : '▶ scout'}
          </TermButton>
        ) : null}
        {ticket.briefState === 'ready' ? (
          <TermButton onClick={scout} title="Write the brief again from the ticket as it is now">
            ↻
          </TermButton>
        ) : null}
        {jobId ? (
          <TermButton onClick={() => onSelect(jobId)}>→ open its job</TermButton>
        ) : ticket.briefState === 'ready' ? (
          <TermButton
            disabled={starting}
            onClick={startFix}
            title="A fix job working from the brief, with tickets and production blocked"
          >
            {starting ? 'starting…' : '▶ start fix'}
          </TermButton>
        ) : null}
        {ticket.briefCost !== null ? (
          <span className="ml-auto px-1.5" style={{ color: 'var(--dirty-grey)' }}>
            ${ticket.briefCost.toFixed(2)}
          </span>
        ) : null}
      </div>
      {startError ? <span style={{ color: THEME.brightRed }}>{startError}</span> : null}
      {ticket.briefState === 'failed' && ticket.briefError ? (
        <span style={{ color: THEME.brightRed }}>{ticket.briefError}</span>
      ) : null}
      {open && ticket.brief ? (
        <pre
          onClick={(e) => e.stopPropagation()}
          className="mt-1 cursor-text whitespace-pre-wrap break-words px-2 py-1.5"
          style={{ background: THEME.black, fontFamily: 'inherit' }}
        >
          {ticket.brief}
        </pre>
      ) : null}
    </div>
  )
}
