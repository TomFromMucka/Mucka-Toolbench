import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { Pencil, Trash2, X } from 'lucide-react'
import type {
  RoadmapCard,
  RoadmapColumn,
  RoadmapCreateInput,
  RoadmapUpdateInput
} from '@shared/types'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

const COLUMNS: { id: RoadmapColumn; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'next', label: 'Next up' },
  { id: 'doing', label: 'Doing' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'parked', label: 'Parked' }
]

interface RoadmapCardModalProps {
  /** When set, the modal opens. */
  open: boolean
  /** Existing card to view/edit. Null = create mode. */
  card: RoadmapCard | null
  /** Default column when creating from a specific lane. */
  defaultColumn?: RoadmapColumn
  /** Initial mode — defaults to 'view' for an existing card, 'create' otherwise. */
  initialMode?: 'view' | 'edit'
  onClose: () => void
}

type Mode = 'view' | 'edit' | 'create'

function fmtDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return (
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

export function RoadmapCardModal({
  open,
  card,
  defaultColumn = 'backlog',
  initialMode,
  onClose
}: RoadmapCardModalProps): React.JSX.Element | null {
  const [mode, setMode] = useState<Mode>(card ? 'view' : 'create')
  const [title, setTitle] = useState(card?.title ?? '')
  const [body, setBody] = useState(card?.body ?? '')
  const [column, setColumn] = useState<RoadmapColumn>(card?.column ?? defaultColumn)
  const [tagsRaw, setTagsRaw] = useState(card?.tags.join(', ') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  // Re-sync local form state whenever the source card changes — e.g. when
  // the parent reopens the modal for a different ticket without unmounting.
  useEffect(() => {
    if (!open) return
    setMode(initialMode ?? (card ? 'view' : 'create'))
    setTitle(card?.title ?? '')
    setBody(card?.body ?? '')
    setColumn(card?.column ?? defaultColumn)
    setTagsRaw(card?.tags.join(', ') ?? '')
    setError(null)
    setBusy(false)
  }, [open, card, defaultColumn, initialMode])

  // Esc closes (or, in edit-from-view, reverts to view).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (mode === 'edit' && card) setMode('view')
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, mode, card, onClose])

  // Focus the title field when entering edit/create.
  useEffect(() => {
    if (!open) return
    if (mode === 'edit' || mode === 'create') {
      requestAnimationFrame(() => titleRef.current?.focus())
    }
  }, [open, mode])

  const tags = tagsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const handleSave = useCallback(async (): Promise<void> => {
    setError(null)
    const t = title.trim()
    if (!t) {
      setError('Title is required.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        const input: RoadmapCreateInput = { title: t, body, column, tags }
        await window.mucka.createRoadmapCard(input)
        onClose()
      } else if (card) {
        const input: RoadmapUpdateInput = { id: card.id, title: t, body, tags }
        await window.mucka.updateRoadmapCard(input)
        if (column !== card.column) {
          await window.mucka.moveRoadmapCard({ id: card.id, column })
        }
        setMode('view')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [body, card, column, mode, onClose, tags, title])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!card) return
    const ok = window.confirm(`Delete this card?\n\n${card.title}`)
    if (!ok) return
    setBusy(true)
    try {
      await window.mucka.deleteRoadmapCard(card.id)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setBusy(false)
    }
  }, [card, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(10, 10, 10, 0.7)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="chamfer-card flex max-h-[88vh] w-[min(720px,92vw)] flex-col"
        style={{ background: 'var(--surface)' }}
      >
        <header
          className="flex items-center gap-2 py-2"
          style={{
            background: 'var(--charcoal)',
            color: 'var(--van-white)',
            paddingLeft: 'calc(var(--notch-card) + 8px)',
            paddingRight: 'calc(var(--notch-card) + 8px)'
          }}
        >
          <h2
            className="min-w-0 flex-1 truncate"
            style={{
              fontFamily: 'var(--font-soehne-breit)',
              fontWeight: 500,
              fontSize: '15px',
              letterSpacing: '-0.005em'
            }}
          >
            {mode === 'create' ? 'New ticket' : mode === 'edit' ? 'Edit ticket' : 'Ticket'}
          </h2>
          {card ? (
            <span
              className="t-label-sm shrink-0"
              style={{ color: 'rgba(234, 233, 232, 0.6)' }}
            >
              {fmtDate(card.updatedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="grid size-7 place-items-center rounded-sm hover:bg-van-white/15"
            style={{ color: 'var(--van-white)' }}
          >
            <Icon icon={X} size={14} strokeWidth={2.25} />
          </button>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ background: 'var(--surface)' }}
        >
          {mode === 'view' && card ? (
            <ViewBody card={card} />
          ) : (
            <EditBody
              titleRef={titleRef}
              title={title}
              body={body}
              column={column}
              tagsRaw={tagsRaw}
              onTitle={setTitle}
              onBody={setBody}
              onColumn={setColumn}
              onTagsRaw={setTagsRaw}
            />
          )}
        </div>

        {error ? (
          <div
            className="px-4 py-1.5 t-body-sm"
            style={{ background: 'rgba(255, 90, 74, 0.15)', color: 'var(--orange)' }}
          >
            {error}
          </div>
        ) : null}

        <footer
          className="flex items-center gap-2 border-t px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
        >
          {mode === 'view' && card ? (
            <>
              <Button
                variant="tertiary"
                size="sm"
                tone="danger"
                leadingIcon={Trash2}
                trailingIcon={null}
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                Delete
              </Button>
              <div className="flex-1" />
              <Button
                variant="secondary"
                size="sm"
                trailingIcon={null}
                onClick={onClose}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Pencil}
                trailingIcon={null}
                onClick={() => setMode('edit')}
              >
                Edit
              </Button>
            </>
          ) : (
            <>
              {mode === 'edit' && card ? (
                <Button
                  variant="tertiary"
                  size="sm"
                  tone="danger"
                  leadingIcon={Trash2}
                  trailingIcon={null}
                  onClick={() => void handleDelete()}
                  disabled={busy}
                >
                  Delete
                </Button>
              ) : null}
              <div className="flex-1" />
              <Button
                variant="secondary"
                size="sm"
                trailingIcon={null}
                onClick={() => {
                  if (mode === 'edit' && card) setMode('view')
                  else onClose()
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                trailingIcon={null}
                onClick={() => void handleSave()}
                disabled={busy || title.trim().length === 0}
              >
                {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}

function ViewBody({ card }: { card: RoadmapCard }): React.JSX.Element {
  return (
    <div className="space-y-3 px-5 py-4">
      <h3
        className="leading-tight"
        style={{
          fontFamily: 'var(--font-soehne-breit)',
          fontWeight: 500,
          fontSize: '20px',
          color: 'var(--van-white)'
        }}
      >
        {card.title}
      </h3>

      <div className="flex flex-wrap items-center gap-2 t-label-sm">
        <span
          className="chamfer-sm px-2 py-0.5"
          style={{
            background: 'rgba(255, 78, 0, 0.18)',
            color: 'var(--orange)',
            fontFamily: 'var(--font-soehne)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}
        >
          {columnLabel(card.column)}
        </span>
        {card.tags.map((t) => (
          <span
            key={t}
            className="chamfer-sm px-2 py-0.5"
            style={{
              background: 'rgba(234, 233, 232, 0.10)',
              color: 'var(--van-white)',
              fontFamily: 'var(--font-soehne)'
            }}
          >
            {t}
          </span>
        ))}
      </div>

      {card.body.trim().length > 0 ? (
        <div className="markdown-body">
          <ReactMarkdown>{card.body}</ReactMarkdown>
        </div>
      ) : (
        <p className="t-body-md text-dirty-grey italic">No description yet.</p>
      )}
    </div>
  )
}

function EditBody({
  titleRef,
  title,
  body,
  column,
  tagsRaw,
  onTitle,
  onBody,
  onColumn,
  onTagsRaw
}: {
  titleRef: React.RefObject<HTMLInputElement | null>
  title: string
  body: string
  column: RoadmapColumn
  tagsRaw: string
  onTitle: (v: string) => void
  onBody: (v: string) => void
  onColumn: (v: RoadmapColumn) => void
  onTagsRaw: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3 px-5 py-4">
      <Field label="Title">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="What's this about?"
          className="chamfer-sm w-full px-3 py-2 focus:outline-none"
          style={{
            fontFamily: 'var(--font-soehne)',
            fontSize: '14px',
            background: 'var(--surface2)',
            color: 'var(--van-white)',
            border: '1px solid var(--border)'
          }}
        />
      </Field>

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Field label="Column">
          <select
            value={column}
            onChange={(e) => onColumn(e.target.value as RoadmapColumn)}
            className="chamfer-sm w-full px-3 py-2 focus:outline-none"
            style={{
              fontFamily: 'var(--font-soehne)',
              fontSize: '13px',
              background: 'var(--surface2)',
              color: 'var(--van-white)',
              border: '1px solid var(--border)',
              appearance: 'none'
            }}
          >
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags (comma-separated)">
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => onTagsRaw(e.target.value)}
            placeholder="frontend, voice, …"
            className="chamfer-sm w-full px-3 py-2 focus:outline-none"
            style={{
              fontFamily: 'var(--font-soehne)',
              fontSize: '13px',
              background: 'var(--surface2)',
              color: 'var(--van-white)',
              border: '1px solid var(--border)'
            }}
          />
        </Field>
      </div>

      <Field
        label="Description"
        hint="Markdown — # heading, **bold**, `code`, lists, links."
      >
        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          rows={12}
          placeholder="Why this matters, acceptance criteria, links, etc."
          className="chamfer-sm w-full px-3 py-2 focus:outline-none"
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '12.5px',
            lineHeight: 1.5,
            background: 'var(--surface2)',
            color: 'var(--van-white)',
            border: '1px solid var(--border)',
            resize: 'vertical'
          }}
        />
      </Field>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className="t-label-sm"
          style={{
            color: 'var(--dirty-grey)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}
        >
          {label}
        </span>
        {hint ? (
          <span className="text-[0.65rem]" style={{ color: 'var(--dirty-grey)' }}>
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </label>
  )
}

function columnLabel(col: RoadmapColumn): string {
  return COLUMNS.find((c) => c.id === col)?.label ?? col
}
