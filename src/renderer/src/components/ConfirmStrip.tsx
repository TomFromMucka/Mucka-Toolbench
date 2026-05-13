import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

/**
 * Renders below the top banner whenever a tool handler has called
 * requestConfirm() or requestEditConfirm() and is waiting. Two modes:
 *   - simple: just summary + Yes/Cancel
 *   - editable: textarea pre-filled with Mucka's proposed text; "Yes"
 *     resolves with the (possibly edited) text
 *
 * Keyboard: ⌘Enter (or Esc to cancel). ⌘Y also works for simple mode.
 */
export function ConfirmStrip(): React.JSX.Element | null {
  const { pendingConfirm } = useMuckaSession()
  const [draft, setDraft] = useState('')

  // Reset draft each time a new editable pending arrives.
  useEffect(() => {
    if (pendingConfirm?.editable) {
      setDraft(pendingConfirm.editable.text)
    }
  }, [pendingConfirm])

  useEffect(() => {
    if (!pendingConfirm) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      // ⌘Enter approves in editable mode; ⌘Y approves in simple mode.
      if (pendingConfirm.editable) {
        if (mod && e.key === 'Enter') {
          e.preventDefault()
          pendingConfirm.resolveEdit?.(draft)
        } else if (!inField && (e.key === 'Escape' || (mod && e.key === '.'))) {
          e.preventDefault()
          pendingConfirm.resolveEdit?.(null)
        }
      } else {
        if (mod && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault()
          pendingConfirm.resolveSimple?.(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          pendingConfirm.resolveSimple?.(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingConfirm, draft])

  if (!pendingConfirm) return null

  const editable = pendingConfirm.editable

  return (
    <div className="paper-plain attention-glow mx-auto mt-2 flex w-[min(960px,92vw)] flex-col gap-2 rounded-md border border-mucka/60 px-4 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.35)]">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.7rem] uppercase tracking-[0.16em] text-mucka-deep">
          Mucka wants to —
        </span>
        <span className="truncate font-[var(--font-hand)] text-[1.05rem] text-ink">
          {pendingConfirm.summary}
        </span>
        {pendingConfirm.note ? (
          <span className="truncate text-[0.78rem] text-ink-faint">
            {pendingConfirm.note}
          </span>
        ) : null}
      </div>

      {editable ? (
        editable.multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            autoFocus
            className="w-full resize-y rounded-sm border border-ink/25 bg-paper-cream px-2 py-1.5 font-mono text-[0.85rem] text-ink focus:border-mucka focus:outline-none focus:ring-1 focus:ring-mucka"
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="w-full rounded-sm border border-ink/25 bg-paper-cream px-2 py-1.5 font-mono text-[0.9rem] text-ink focus:border-mucka focus:outline-none focus:ring-1 focus:ring-mucka"
          />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {editable ? (
          <span className="mr-auto text-[0.7rem] text-ink-faint">
            edit if you want, ⌘Enter to send · Esc to cancel
          </span>
        ) : null}
        <button
          type="button"
          onClick={() =>
            editable
              ? pendingConfirm.resolveEdit?.(null)
              : pendingConfirm.resolveSimple?.(false)
          }
          className="rounded-sm border border-ink/30 px-3 py-1 font-sans text-[0.78rem] text-ink hover:bg-paper-shadow"
        >
          Cancel <span className="text-ink-faint">(Esc)</span>
        </button>
        <button
          type="button"
          disabled={editable !== null && draft.trim().length === 0}
          onClick={() =>
            editable
              ? pendingConfirm.resolveEdit?.(draft)
              : pendingConfirm.resolveSimple?.(true)
          }
          className={clsx(
            'rounded-sm bg-mucka px-3 py-1 font-sans text-[0.78rem] font-semibold uppercase tracking-wide text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:bg-mucka-deep',
            editable !== null && draft.trim().length === 0 && 'cursor-not-allowed opacity-50'
          )}
        >
          {editable ? (
            <>
              Send <span className="text-paper-cream/75">(⌘↵)</span>
            </>
          ) : (
            <>
              Yes, do it <span className="text-paper-cream/75">(⌘Y)</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
