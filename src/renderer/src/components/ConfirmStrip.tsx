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
    <div
      className="chamfer-card attention-glow mx-auto mt-2 flex w-[min(960px,92vw)] flex-col gap-2 px-4 py-2.5"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="t-label-sm text-orange">Mucka wants to —</span>
        <span
          className="truncate"
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontWeight: 500,
            fontSize: '17px',
            color: 'var(--van-white)'
          }}
        >
          {pendingConfirm.summary}
        </span>
        {pendingConfirm.note ? (
          <span className="t-body-sm truncate text-dirty-grey">
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
            className="w-full resize-y rounded-sm px-2 py-1.5 font-mono text-[0.85rem] focus:outline-none"
            style={{
              background: 'var(--surface2)',
              color: 'var(--van-white)',
              border: '1px solid var(--border-mid)'
            }}
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="w-full rounded-sm px-2 py-1.5 font-mono text-[0.9rem] focus:outline-none"
            style={{
              background: 'var(--surface2)',
              color: 'var(--van-white)',
              border: '1px solid var(--border-mid)'
            }}
          />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {editable ? (
          <span className="t-body-sm mr-auto text-dirty-grey">
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
          className="mucka-btn mucka-btn-tertiary mucka-btn-sm"
        >
          <span className="mucka-btn-label">
            Cancel <span style={{ opacity: 0.6 }}>(Esc)</span>
          </span>
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
            'mucka-btn mucka-btn-primary mucka-btn-sm',
            editable !== null && draft.trim().length === 0 && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="mucka-btn-label">
            {editable ? (
              <>
                Send <span style={{ opacity: 0.7 }}>(⌘↵)</span>
              </>
            ) : (
              <>
                Yes, do it <span style={{ opacity: 0.7 }}>(⌘Y)</span>
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  )
}
