import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  Ticket,
  TicketAction,
  TicketAttachment,
  TicketDetail,
  TicketFile,
  TicketSendPreview,
  TicketSendStatus
} from '@shared/types'
import { Dim, TermButton } from './IntakeBits'
import { bytes, CATEGORY_LABELS, STATUS_LABELS, when } from './intakeFormat'
import { TERMINAL_FONT, THEME } from './terminalTheme'
import { cachedTicket, loadTicket } from '../state/ticketCache'
import { useJobs } from '../state/JobsContext'

const DIM = 'var(--dirty-grey)'

/** Unsent replies survive closing the modal by accident. */
const drafts = new Map<string, string>()

type Pending = { action: TicketAction; label: string; preview: TicketSendPreview }
type TicketTab = 'ticket' | 'conversation'

/**
 * A ticket in full, and everything /admin/support can do to it. Nothing
 * leaves until Tom has seen exactly who it reaches and how, the same
 * preview ticket.ts prints, and pressed send on that.
 */
export function TicketModal({
  reference,
  summary,
  onClose,
  onJob
}: {
  reference: string
  /** The list's row, shown at once while the full ticket loads. */
  summary: Ticket | null
  onClose: () => void
  /** Show a job, after starting one or to go to the one it has. */
  onJob: (jobId: string) => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<TicketDetail | null>(() => cachedTicket(reference))
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TicketTab>('ticket')
  const { jobs } = useJobs()
  const job = jobs.find((j) => j.source === `ticket:${reference}`)
  const [starting, setStarting] = useState(false)
  const [reply, setReply] = useState(() => drafts.get(reference) ?? '')
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(
    (): Promise<void> =>
      loadTicket(reference)
        .then((d) => {
          setDetail(d)
          setError(null)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))),
    [reference]
  )

  useEffect(() => {
    void load()
    void window.mucka.markTicketRead(reference)
  }, [load, reference])

  const startJob = (): void => {
    setStarting(true)
    setNote(null)
    window.mucka
      .startTicketJob(reference)
      .then((started) => {
        onJob(started.id)
        onClose()
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
      .finally(() => setStarting(false))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (pending) setPending(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  const editReply = (text: string): void => {
    setReply(text)
    if (text) drafts.set(reference, text)
    else drafts.delete(reference)
  }

  const ask = async (
    label: string,
    status?: TicketSendStatus,
    withReply = false
  ): Promise<void> => {
    const action: TicketAction = { reference, status }
    if (withReply) action.message = reply.trim()
    setBusy(true)
    setNote(null)
    try {
      setPending({ action, label, preview: await window.mucka.previewTicketAction(action) })
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    if (!pending) return
    setBusy(true)
    setNote(null)
    try {
      const result = await window.mucka.sendTicketAction(pending.action)
      if (result.replied) editReply('')
      setNote(
        [
          result.replied ? 'Reply sent.' : null,
          result.status ? `Now ${STATUS_LABELS[result.status] ?? result.status}.` : null,
          result.heldUntilLabel
            ? `Their notifications are held until ${result.heldUntilLabel}.`
            : null,
          result.attachmentError
        ]
          .filter(Boolean)
          .join(' ')
      )
      setPending(null)
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
      setPending(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const hasReply = reply.trim().length > 0
  const head = detail ?? summary
  const status = detail?.status

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.6)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] w-[min(960px,94vw)] flex-col"
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
          <span style={{ fontWeight: 700 }}>{reference}</span>
          {head ? (
            <>
              <span style={{ color: head.status === 'open' ? THEME.yellow : DIM }}>
                {STATUS_LABELS[head.status] ?? head.status}
              </span>
              {head.priority ? <span style={{ color: DIM }}>{head.priority}</span> : null}
              {head.category ? (
                <span style={{ color: THEME.blue }}>
                  {CATEGORY_LABELS[head.category] ?? head.category}
                </span>
              ) : null}
              {!head.customerVisible ? (
                <span style={{ color: DIM }}>· not visible to them</span>
              ) : null}
            </>
          ) : null}
          <span className="ml-auto" />
          {job ? (
            <TermButton
              onClick={() => {
                onJob(job.id)
                onClose()
              }}
            >
              → open its job
            </TermButton>
          ) : (
            <TermButton
              disabled={starting}
              onClick={startJob}
              title="A fresh job that reads this ticket, does the groundwork and drafts the fix"
            >
              {starting ? 'starting…' : '▶ start job'}
            </TermButton>
          )}
          <TermButton tone="dim" onClick={onClose} title="Close (Esc)">
            × close
          </TermButton>
        </header>

        {error ? <Dim error>{error}</Dim> : null}

        {!detail && summary ? (
          <div className="px-4 pt-2.5 pb-2" style={{ borderBottom: `1px solid ${THEME.black}` }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{summary.subject}</div>
            <div style={{ color: DIM }}>
              {[summary.business, summary.raiser].filter(Boolean).join(' — ')}
            </div>
          </div>
        ) : null}
        {!detail && !error ? <Dim>Opening the thread…</Dim> : null}

        {detail ? (
          <>
            <div className="px-4 pt-2.5 pb-2" style={{ borderBottom: `1px solid ${THEME.black}` }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{detail.subject}</div>
              <div style={{ color: DIM }}>
                {detail.business ?? 'Unknown business'}
                {detail.raiser
                  ? ` — ${detail.raiser.name}${detail.raiser.role ? ` (${detail.raiser.role})` : ''}${detail.raiser.email ? ` <${detail.raiser.email}>` : ''}`
                  : ' — raiser unknown'}
              </div>
              <div style={{ color: DIM }}>
                raised {when(detail.createdAt)} · updated {when(detail.updatedAt)}
                {detail.resolvedAt ? ` · resolved ${when(detail.resolvedAt)}` : ''}
              </div>
              {detail.participants.length > 0 ? (
                <div style={{ color: DIM }}>
                  also on this ticket: {detail.participants.join(', ')}
                </div>
              ) : null}
              {detail.conversation ? (
                <Tabs
                  tab={tab}
                  setTab={setTab}
                  conversation={detail.conversation.messages.length}
                />
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {tab === 'conversation' && detail.conversation ? (
                <Conversation detail={detail} />
              ) : (
                <Thread detail={detail} />
              )}
            </div>

            <footer
              className="flex flex-col gap-1.5 px-4 py-2.5"
              style={{ borderTop: `1px solid ${THEME.black}` }}
            >
              {pending ? (
                <Confirm
                  pending={pending}
                  busy={busy}
                  onSend={send}
                  onCancel={() => setPending(null)}
                />
              ) : (
                <>
                  <textarea
                    value={reply}
                    onChange={(e) => editReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.metaKey && hasReply && !busy) {
                        e.preventDefault()
                        void ask('Send reply', undefined, true)
                      }
                    }}
                    rows={4}
                    placeholder={`Reply to ${detail.raiser?.name ?? 'them'}… (⌘↵ to preview)`}
                    className="w-full resize-y px-2 py-1.5 outline-none placeholder:text-[var(--dirty-grey)]"
                    style={{
                      fontFamily: 'inherit',
                      background: THEME.black,
                      color: THEME.foreground
                    }}
                  />
                  <div className="flex flex-wrap items-baseline gap-1">
                    <TermButton
                      disabled={busy || !hasReply}
                      onClick={() => void ask('Send reply', undefined, true)}
                    >
                      send reply
                    </TermButton>
                    <TermButton
                      disabled={busy || !hasReply || status === 'resolved' || status === 'closed'}
                      onClick={() => void ask('Reply and resolve', 'resolved', true)}
                      title="Reply first, then mark it resolved"
                    >
                      reply + resolve
                    </TermButton>
                    <span className="mx-1" style={{ color: THEME.brightBlack }}>
                      │
                    </span>
                    {status === 'open' ? (
                      <TermButton
                        disabled={busy}
                        onClick={() => void ask('Mark in progress', 'in_progress')}
                      >
                        in progress
                      </TermButton>
                    ) : null}
                    {status === 'open' || status === 'in_progress' ? (
                      <TermButton disabled={busy} onClick={() => void ask('Resolve', 'resolved')}>
                        resolve
                      </TermButton>
                    ) : null}
                    {status !== 'closed' ? (
                      <TermButton
                        tone="dim"
                        disabled={busy}
                        onClick={() => void ask('Close', 'closed')}
                        title="Closes quietly: nobody is told"
                      >
                        close
                      </TermButton>
                    ) : null}
                    {busy ? <span style={{ color: DIM }}>working…</span> : null}
                  </div>
                </>
              )}
              {note ? <span style={{ color: DIM }}>{note}</span> : null}
            </footer>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

/** What's about to happen, in ticket.ts's own words, and the only send button. */
function Confirm({
  pending,
  busy,
  onSend,
  onCancel
}: {
  pending: Pending
  busy: boolean
  onSend: () => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const { action, preview } = pending
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontWeight: 700 }}>{pending.label}?</span>
      {action.message ? (
        <pre
          className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-2 py-1.5"
          style={{ background: THEME.black, fontFamily: 'inherit' }}
        >
          {action.message}
        </pre>
      ) : null}
      {preview.to ? (
        <span>
          status {STATUS_LABELS[preview.from] ?? preview.from} →{' '}
          {STATUS_LABELS[preview.to] ?? preview.to}
        </span>
      ) : null}
      <span style={{ color: DIM }}>will notify</span>
      {preview.nobody ? (
        <span className="pl-2">{preview.nobody}</span>
      ) : (
        preview.channels.map((c) => (
          <span key={c} className="pl-2">
            {c}
          </span>
        ))
      )}
      {preview.heldUntilLabel ? (
        <span style={{ color: THEME.yellow }}>
          Held until {preview.heldUntilLabel}: it&apos;s outside 08:00–20:00. The reply shows in
          their thread now; the push, email and WhatsApp wait.
        </span>
      ) : null}
      <div className="mt-1 flex gap-1">
        <TermButton disabled={busy} onClick={() => void onSend()}>
          {busy ? 'sending…' : '✔ send'}
        </TermButton>
        <TermButton tone="dim" disabled={busy} onClick={onCancel}>
          back
        </TermButton>
      </div>
    </div>
  )
}

function Thread({ detail }: { detail: TicketDetail }): React.JSX.Element {
  const ticketFiles = detail.attachments.filter((a) => a.messageId === null)
  return (
    <div className="flex flex-col gap-3">
      <Message
        who={`${detail.raiser?.name ?? 'customer'} · the ticket`}
        at={detail.createdAt}
        tone="user"
        text={detail.body}
      >
        <Attachments reference={detail.reference} files={ticketFiles} />
      </Message>
      {detail.adminNotes ? (
        <div className="px-2 py-1.5" style={{ border: `1px dashed ${THEME.brightBlack}` }}>
          <div style={{ color: DIM }}>admin notes · not visible to them</div>
          <div className="whitespace-pre-wrap break-words">{detail.adminNotes}</div>
        </div>
      ) : null}
      {detail.messages.map((m) => (
        <Message
          key={m.id}
          who={`${m.authorType}/${m.authorName ?? m.authorType}`}
          at={m.createdAt}
          tone={m.authorType === 'admin' ? 'admin' : m.authorType === 'system' ? 'system' : 'user'}
          text={m.content}
          held={m.heldUntil}
        >
          <Attachments
            reference={detail.reference}
            files={detail.attachments.filter((a) => a.messageId === m.id)}
          />
        </Message>
      ))}
      {detail.messages.length === 0 ? <span style={{ color: DIM }}>No replies yet.</span> : null}
    </div>
  )
}

function Message({
  who,
  at,
  tone,
  text,
  held,
  children
}: {
  who: string
  at: number
  tone: 'user' | 'admin' | 'system'
  text: string
  held?: number | null
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontWeight: 700,
            color: tone === 'admin' ? THEME.cyan : tone === 'system' ? DIM : THEME.foreground
          }}
        >
          {who}
        </span>
        <span style={{ color: DIM }}>{when(at)}</span>
        {held ? (
          <span style={{ color: THEME.yellow }}>notifications held until {when(held)}</span>
        ) : null}
      </div>
      <div
        className="whitespace-pre-wrap break-words pl-2"
        style={{
          borderLeft: `2px solid ${tone === 'admin' ? THEME.cyan : THEME.black}`,
          fontStyle: tone === 'system' ? 'italic' : undefined,
          color: tone === 'system' ? DIM : undefined
        }}
      >
        {text || '(empty)'}
      </div>
      {children}
    </div>
  )
}

function Attachments({
  reference,
  files
}: {
  reference: string
  files: TicketAttachment[]
}): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 pt-1 pl-2">
      {files.map((f) => (
        <Attachment key={f.id} reference={reference} file={f} />
      ))}
    </div>
  )
}

/**
 * A customer's file. Pictures load inline; a PDF opens in Preview; anything
 * else is only ever shown in Finder, never opened by the cockpit.
 */
function Attachment({
  reference,
  file
}: {
  reference: string
  file: TicketAttachment
}): React.JSX.Element {
  const image = file.mimeType.startsWith('image/')
  const [loaded, setLoaded] = useState<TicketFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    if (!image) return
    let stale = false
    void window.mucka
      .getTicketFile(reference, file.id)
      .then((f) => {
        if (!stale) setLoaded(f)
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [image, reference, file.id])

  const open = (): void => {
    setOpening(true)
    setError(null)
    void window.mucka
      .openTicketFile(reference, file.id)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setOpening(false))
  }

  const pdf = file.mimeType === 'application/pdf'
  const inline = image && loaded?.dataUrl
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span>📎 {file.filename}</span>
        <span style={{ color: DIM }}>{bytes(file.sizeBytes)}</span>
        <TermButton disabled={opening} onClick={open}>
          {opening ? 'fetching…' : pdf || inline ? 'open in Preview' : 'show in Finder'}
        </TermButton>
      </div>
      {inline ? (
        <img
          src={loaded.dataUrl ?? undefined}
          alt={file.filename}
          onClick={open}
          className="max-h-64 max-w-full cursor-zoom-in self-start object-contain"
          style={{ background: THEME.black }}
        />
      ) : image && !loaded && !error ? (
        <span style={{ color: DIM }}>loading picture…</span>
      ) : null}
      {error ? <span style={{ color: THEME.brightRed }}>{error}</span> : null}
    </div>
  )
}

function Conversation({ detail }: { detail: TicketDetail }): React.JSX.Element | null {
  const c = detail.conversation
  if (!c) return null
  return (
    <div className="flex flex-col gap-2.5">
      <div style={{ color: DIM }}>
        {[c.channel, c.source].filter(Boolean).join(' · ')}
        {c.startedAt ? ` · started ${when(c.startedAt)}` : ''}
        {c.messageCount !== null ? ` · ${c.messageCount} messages` : ''}
        {c.truncated ? ' · showing the newest 200' : ''}
      </div>
      {c.summary ? (
        <div className="whitespace-pre-wrap px-2 py-1.5" style={{ background: THEME.black }}>
          {c.summary}
        </div>
      ) : null}
      {c.messages.map((m, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              style={{ fontWeight: 700, color: m.role === 'user' ? THEME.foreground : THEME.green }}
            >
              {m.role}
            </span>
            <span style={{ color: DIM }}>{when(m.createdAt)}</span>
          </div>
          {m.content.trim() ? (
            <div className="whitespace-pre-wrap break-words pl-2">{m.content}</div>
          ) : null}
          {m.tools.length > 0 ? (
            <div className="pl-2" style={{ color: DIM }}>
              tools: {m.tools.join(', ')}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function Tabs({
  tab,
  setTab,
  conversation
}: {
  tab: TicketTab
  setTab: (tab: TicketTab) => void
  /** How many conversation messages. */
  conversation: number
}): React.JSX.Element {
  return (
    <div className="mt-1.5 flex gap-1">
      <TabButton active={tab === 'ticket'} onClick={() => setTab('ticket')}>
        ticket
      </TabButton>
      <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')}>
        conversation ({conversation})
      </TabButton>
    </div>
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
        color: active ? THEME.brightWhite : DIM,
        background: active ? THEME.black : undefined,
        fontWeight: active ? 700 : 400
      }}
    >
      {children}
    </button>
  )
}
