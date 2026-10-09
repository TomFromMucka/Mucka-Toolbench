import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useAgentsState } from '../state/AgentsContext'
import { useJobs } from '../state/JobsContext'
import { useNeedsYou } from '../state/NeedsYouContext'

function waited(since: number, now: number): string {
  const mins = Math.floor((now - since) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/**
 * Everyone waiting on Tom, in queue order, right under the terminal's
 * input: his eyes are already there when he finishes typing, so the next
 * one is a glance down rather than across the screen. Clicking one puts
 * its terminal in the middle.
 */
export function WaitingStrip({
  selected,
  onSelect
}: {
  selected: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { queue } = useNeedsYou()
  const { agents } = useAgentsState()
  const { jobs } = useJobs()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="chamfer-frame-sm flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 py-1.5 [--fill:var(--surface2)] [--ring:var(--border)]">
      <span className="t-label-sm shrink-0 pr-1 text-dirty-grey">Waiting on you</span>
      {queue.length === 0 ? (
        <span className="t-body-sm text-dirty-grey">Nobody needs you.</span>
      ) : (
        queue.map((entry, i) => {
          const name =
            jobs.find((j) => j.id === entry.jobId)?.title ??
            agents.find((a) => a.id === entry.agentId)?.displayName ??
            entry.key
          const p = entry.pending
          const first = i === 0
          const current = entry.key === selected
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onSelect(entry.key)}
              className={clsx(
                'chamfer-frame-sm flex max-w-[22rem] shrink-0 items-baseline gap-1.5 px-2 py-1 text-left hover:[--fill:var(--surface)]',
                current ? '[--fill:var(--surface)]' : '[--fill:var(--surface2)]',
                first
                  ? '[--ring:var(--orange)]'
                  : current
                    ? '[--ring:var(--van-white)]'
                    : '[--ring:var(--border)]'
              )}
              title={name}
            >
              <span
                className="font-mono text-[0.68rem]"
                style={{ color: first ? 'var(--orange)' : 'var(--dirty-grey)' }}
              >
                {i + 1}
              </span>
              <span className="t-body-sm truncate text-van-white">{name}</span>
              <span className="t-body-sm shrink-0 text-dirty-grey">
                {p
                  ? `${p.kind === 'question' ? 'asks' : 'needs a yes'} · ${waited(p.since, now)}`
                  : 'your turn'}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
