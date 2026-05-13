import { useEffect } from 'react'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

/**
 * A small overlay strip below the top banner. Renders only when a
 * tool handler has called requestConfirm() and is waiting. ⌘Y to
 * accept, Esc to cancel. Auto-dismisses with "no" via the timeout
 * baked into the pending entry's resolve.
 */
export function ConfirmStrip(): React.JSX.Element | null {
  const { pendingConfirm } = useMuckaSession()

  useEffect(() => {
    if (!pendingConfirm) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        pendingConfirm.resolve(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        pendingConfirm.resolve(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingConfirm])

  if (!pendingConfirm) return null

  return (
    <div className="paper-plain attention-glow mx-auto mt-2 flex w-[min(960px,92vw)] items-start gap-3 rounded-md border border-mucka/60 px-4 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.35)]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => pendingConfirm.resolve(false)}
          className="rounded-sm border border-ink/30 px-3 py-1 font-sans text-[0.78rem] text-ink hover:bg-paper-shadow"
        >
          Cancel <span className="text-ink-faint">(Esc)</span>
        </button>
        <button
          type="button"
          onClick={() => pendingConfirm.resolve(true)}
          className="rounded-sm bg-mucka px-3 py-1 font-sans text-[0.78rem] font-semibold uppercase tracking-wide text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:bg-mucka-deep"
        >
          Yes, do it <span className="text-paper-cream/75">(⌘Y)</span>
        </button>
      </div>
    </div>
  )
}
