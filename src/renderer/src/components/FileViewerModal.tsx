import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, FolderSearch, Pencil, Save, X } from 'lucide-react'
import type { FilePreview } from '@shared/types'
import { Icon } from './ui/Icon'

interface FileViewerModalProps {
  path: string | null
  onClose: () => void
}

/**
 * In-app file preview/editor. Opens whenever Tom clicks a file in the
 * explorer so .md docs don't get hijacked by an external IDE and .env
 * files don't fall into the macOS "no application set" dialog.
 *
 * Text/code files can be edited in place (Edit → save writes back via
 * `fs:writeFile`, gated to the home dir). Images render an inline
 * preview. The "Open in default app" button is still one click away.
 */
export function FileViewerModal({ path, onClose }: FileViewerModalProps): React.ReactPortal | null {
  // Track which path the current `preview`/`loading` belong to. When
  // `path` changes (or goes null) the effect runs and we don't render
  // stale content from the previous open.
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return undefined
    let cancelled = false
    setLoadingPath(path)
    setPreview(null)
    setEditing(false)
    setSaveError(null)
    void window.mucka
      .readFilePreview(path)
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        setLoadingPath(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setPreview({ kind: 'error', path, message })
        setLoadingPath(null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const loading = path !== null && loadingPath === path
  const canEdit = preview?.kind === 'ok' && !preview.truncated

  const startEdit = useCallback(() => {
    if (preview?.kind !== 'ok') return
    setDraft(preview.text)
    setSaveError(null)
    setEditing(true)
  }, [preview])

  const handleSave = useCallback(async () => {
    if (!path) return
    setSaving(true)
    setSaveError(null)
    try {
      await window.mucka.writeFile(path, draft)
      setPreview({
        kind: 'ok',
        path,
        text: draft,
        bytes: new TextEncoder().encode(draft).length,
        truncated: false
      })
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [path, draft])

  useEffect(() => {
    if (!path) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !editing) onClose()
      if (editing && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [path, onClose, editing, handleSave])

  if (!path) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.55)' }}
      onMouseDown={(e) => {
        // Backdrop-only click closes; ignore drag-releases that started
        // inside the modal body. Don't close out from under an edit.
        if (e.target === e.currentTarget && !editing) onClose()
      }}
    >
      <div
        className="chamfer-lg flex max-h-[85vh] w-[min(92vw,980px)] min-h-0 flex-col overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <ModalHeader path={path} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-auto" style={{ background: 'var(--surface2)' }}>
          {loading ? (
            <LoadingBody />
          ) : editing ? (
            <EditView draft={draft} onChange={setDraft} />
          ) : preview ? (
            <Body preview={preview} />
          ) : null}
        </div>
        {saveError ? (
          <div
            className="border-t px-4 py-1.5"
            style={{
              borderColor: 'var(--border)',
              background: 'rgba(255, 90, 74, 0.15)',
              color: 'var(--van-white)',
              fontFamily: 'var(--font-soehne)',
              fontSize: '11px'
            }}
          >
            Save failed: {saveError}
          </div>
        ) : null}
        <ModalFooter
          path={path}
          preview={preview}
          editing={editing}
          canEdit={canEdit}
          saving={saving}
          onEdit={startEdit}
          onSave={() => void handleSave()}
          onCancelEdit={() => {
            setEditing(false)
            setSaveError(null)
          }}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body
  )
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function ModalHeader({
  path,
  onClose
}: {
  path: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 border-b px-4 py-2.5"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--charcoal)',
        color: 'var(--van-white)'
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontWeight: 500,
            fontSize: '13px',
            letterSpacing: '0.03em',
            textTransform: 'uppercase'
          }}
          title={path}
        >
          {basename(path)}
        </div>
        <div
          className="truncate"
          title={path}
          style={{
            fontFamily: 'var(--font-soehne)',
            fontSize: '11px',
            color: 'var(--dirty-grey)'
          }}
        >
          {path}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close"
        className="grid size-7 place-items-center rounded-sm hover:bg-van-white/15"
        style={{ color: 'var(--van-white)' }}
      >
        <Icon icon={X} size={16} strokeWidth={2.25} />
      </button>
    </div>
  )
}

function LoadingBody(): React.JSX.Element {
  return (
    <div
      className="grid h-full place-items-center px-6 py-8"
      style={{
        fontFamily: 'var(--font-soehne)',
        fontSize: '12px',
        color: 'var(--dirty-grey)'
      }}
    >
      Reading…
    </div>
  )
}

function Body({ preview }: { preview: FilePreview }): React.JSX.Element {
  if (preview.kind === 'ok') return <TextView text={preview.text} />
  if (preview.kind === 'image') return <ImageView dataUrl={preview.dataUrl} path={preview.path} />
  if (preview.kind === 'binary') {
    return (
      <Placeholder
        title="Binary file"
        detail={`${formatBytes(preview.bytes)} — preview disabled for non-text files. Use the OS handler or reveal in Finder.`}
      />
    )
  }
  if (preview.kind === 'too-large') {
    return (
      <Placeholder
        title="File too large"
        detail={`${formatBytes(preview.bytes)} — the preview is capped at ${formatBytes(preview.cap)}. Open in your editor for the full file.`}
      />
    )
  }
  if (preview.kind === 'missing') {
    return <Placeholder title="File missing" detail="The path no longer exists on disk." />
  }
  return <Placeholder title="Couldn't read" detail={preview.message} />
}

function ImageView({ dataUrl, path }: { dataUrl: string; path: string }): React.JSX.Element {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <img
        src={dataUrl}
        alt={basename(path)}
        className="max-h-[70vh] max-w-full object-contain"
        style={{ background: 'var(--surface)' }}
      />
    </div>
  )
}

function EditView({
  draft,
  onChange
}: {
  draft: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <textarea
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoFocus
      className="block h-full w-full resize-none border-0 px-4 py-3 focus:outline-none"
      style={{
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: '12px',
        lineHeight: 1.55,
        color: 'var(--van-white)',
        background: 'transparent',
        tabSize: 2,
        MozTabSize: 2,
        minHeight: '50vh'
      }}
    />
  )
}

function TextView({ text }: { text: string }): React.JSX.Element {
  // Line-numbered monospace render. Splitting on \n keeps trailing
  // empty lines visible, which matters for .env files where Tom uses
  // them as section separators.
  const lines = useMemo(() => text.split('\n'), [text])
  const gutterWidth = String(lines.length).length
  return (
    <pre
      className="m-0 px-0 py-3"
      style={{
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: '12px',
        lineHeight: 1.55,
        color: 'var(--van-white)',
        whiteSpace: 'pre',
        tabSize: 2,
        MozTabSize: 2
      }}
    >
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            className="select-none px-3 text-right"
            style={{
              minWidth: `${gutterWidth + 2}ch`,
              color: 'rgba(234, 233, 232, 0.35)',
              borderRight: '1px solid var(--border)'
            }}
          >
            {i + 1}
          </span>
          <span className="flex-1 whitespace-pre px-3">{line || ' '}</span>
        </div>
      ))}
    </pre>
  )
}

function Placeholder({
  title,
  detail
}: {
  title: string
  detail: string
}): React.JSX.Element {
  return (
    <div
      className="grid h-full place-items-center px-6 py-10 text-center"
      style={{
        fontFamily: 'var(--font-soehne)',
        color: 'var(--van-white)'
      }}
    >
      <div className="max-w-md">
        <div
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontSize: '14px',
            fontWeight: 500,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--orange)',
            marginBottom: '0.5rem'
          }}
        >
          {title}
        </div>
        <p style={{ fontSize: '13px', color: 'var(--dirty-grey)', lineHeight: 1.5 }}>
          {detail}
        </p>
      </div>
    </div>
  )
}

function ModalFooter({
  path,
  preview,
  editing,
  canEdit,
  saving,
  onEdit,
  onSave,
  onCancelEdit,
  onClose
}: {
  path: string
  preview: FilePreview | null
  editing: boolean
  canEdit: boolean
  saving: boolean
  onEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onClose: () => void
}): React.JSX.Element {
  const bytes = preview && 'bytes' in preview ? preview.bytes : null
  return (
    <div
      className="flex items-center gap-2 border-t px-3 py-2"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--charcoal)',
        color: 'var(--dirty-grey)',
        fontFamily: 'var(--font-soehne)',
        fontSize: '11px'
      }}
    >
      <span className="flex-1">{bytes !== null ? formatBytes(bytes) : ''}</span>
      {editing ? (
        <>
          <FooterButton icon={X} label="Cancel" onClick={onCancelEdit} />
          <FooterButton
            icon={Save}
            label={saving ? 'Saving…' : 'Save (⌘S)'}
            onClick={onSave}
            primary
          />
        </>
      ) : (
        <>
          {canEdit ? <FooterButton icon={Pencil} label="Edit" onClick={onEdit} /> : null}
          <FooterButton
            icon={FolderSearch}
            label="Reveal"
            onClick={() => void window.mucka.revealInOs(path)}
          />
          <FooterButton
            icon={ExternalLink}
            label="Open in default app"
            onClick={() => {
              void window.mucka.openPathInOs(path)
              onClose()
            }}
          />
        </>
      )}
    </div>
  )
}

function FooterButton({
  icon,
  label,
  onClick,
  primary = false
}: {
  icon: typeof X
  label: string
  onClick: () => void
  primary?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="chamfer-sm flex items-center gap-1.5 px-2.5 py-1 transition-colors hover:bg-van-white/10"
      style={{
        border: '1px solid var(--border)',
        color: primary ? 'var(--charcoal)' : 'var(--van-white)',
        fontFamily: 'var(--font-soehne)',
        fontSize: '11px',
        background: primary ? 'var(--orange)' : 'rgba(234, 233, 232, 0.04)'
      }}
    >
      <Icon icon={icon} size={12} strokeWidth={2.25} />
      {label}
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
