import { useEffect, useRef, useState } from 'react'
import { useAgentsState } from '../state/AgentsContext'
import { useNeedsYou } from '../state/NeedsYouContext'
import { NeedsYouCard } from './NeedsYouCard'

/**
 * Who's waiting on Tom, in the top banner, and the place to answer them.
 *
 * The per-panel glow is easy to miss on a 3840px screen with six
 * terminals, and this is the one place he's always looking. It names the
 * agent at the front of the queue and how many are behind it; clicking
 * opens the queue as cards he can answer without leaving it. Deliberately
 * silent when nobody needs anything, so it reads as a real alert rather
 * than furniture.
 */
export function AttentionRollCall(): React.JSX.Element | null {
  const { agents } = useAgentsState()
  const { queue } = useNeedsYou()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)

  // An empty queue closes the list without anyone having to dismiss it.
  const shown = open && queue.length > 0

  // Waiting times on the cards tick over while the list is open.
  useEffect(() => {
    if (!shown) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [shown])

  if (queue.length === 0) return null

  const head = queue[0]
  const headName = agents.find((a) => a.id === head.agentId)?.displayName ?? head.agentId
  const others = queue.length - 1
  const what = head.pending
    ? head.pending.kind === 'question'
      ? 'asks'
      : 'needs a yes'
    : 'waiting'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setNow(Date.now())
          setOpen(!shown)
        }}
        aria-expanded={shown}
        className="chamfer-sm flex items-center gap-2 px-2.5 py-1"
        style={{
          background: 'rgba(255, 78, 0, 0.16)',
          boxShadow: 'inset 0 0 0 1px rgba(255, 78, 0, 0.55)'
        }}
        title="Who's waiting on you (⌘J jumps to the next one)"
      >
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: 'var(--orange)' }}
        />
        <span
          className="text-[0.68rem] uppercase tracking-[0.16em]"
          style={{ color: 'var(--orange)' }}
        >
          {what}
        </span>
        <span
          className="max-w-[22rem] truncate text-[0.8rem]"
          style={{ color: 'var(--van-white)' }}
        >
          {headName}
          {others > 0 ? <span style={{ opacity: 0.6 }}>{` · +${others} more`}</span> : null}
        </span>
      </button>

      {shown ? (
        <div
          className="chamfer-sm absolute right-0 top-full z-50 mt-2 flex max-h-[70vh] w-[36rem] flex-col gap-2 overflow-y-auto p-2"
          style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--border-mid)' }}
        >
          <span className="t-label-sm px-1 text-dirty-grey">
            Waiting on you · blocked first, oldest first
          </span>
          {queue.map((entry, i) => (
            <NeedsYouCard
              key={entry.pending?.id ?? entry.agentId}
              entry={entry}
              place={i + 1}
              now={now}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
