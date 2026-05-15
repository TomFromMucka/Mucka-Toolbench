import clsx from 'clsx'
import type { JobEvent, JobEventSource, JobEventTone } from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { useEventsState } from '../state/EventsContext'
import { Clipboard } from './Clipboard'

const TONE_TEXT: Record<JobEventTone, string> = {
  normal: 'text-van-white',
  attention: 'text-orange font-semibold',
  win: 'text-status-ok',
  bad: 'text-status-bad'
}

const TONE_DOT: Record<JobEventTone, string> = {
  normal: 'bg-dirty-grey',
  attention: 'bg-orange',
  win: 'bg-status-ok',
  bad: 'bg-status-bad'
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDayBreak(prev: number | null, current: number): string | null {
  const a = prev ? new Date(prev) : null
  const b = new Date(current)
  if (!a || a.toDateString() !== b.toDateString()) {
    return b.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }
  return null
}

export function JobSheet(): React.JSX.Element {
  const { agents } = useAgentsState()
  const { events, loading } = useEventsState()

  const labelFor = (source: JobEventSource): string => {
    if (source === 'mucka') return 'mucka'
    if (source === 'system') return 'system'
    const a = agents.find((x) => x.id === source)
    return a ? a.displayName.toLowerCase() : String(source)
  }

  return (
    <Clipboard
      title="Job Sheet"
      subtitle="recent activity"
      className="min-h-0"
      rightSlot={<span>{events.length}</span>}
    >
      <div
        className="h-full min-h-0 overflow-y-auto px-3 py-2"
        style={{ background: 'var(--surface)' }}
      >
        {loading ? (
          <p className="t-body-md text-dirty-grey">Loading…</p>
        ) : events.length === 0 ? (
          <p className="t-body-md text-dirty-grey">
            No activity yet — events appear as Vercel deploys move, PRs open,
            and Mucka makes changes.
          </p>
        ) : (
          <ol className="space-y-[2px]">
            {events.map((event: JobEvent, idx) => {
              const prevTs = idx > 0 ? events[idx - 1]?.ts ?? null : null
              const day = fmtDayBreak(prevTs, event.ts)
              return (
                <li key={event.id}>
                  {day ? (
                    <div className="t-label-sm mt-3 mb-1 text-dirty-grey">
                      {day}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[44px_minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-2 t-body-md leading-[26px]">
                    <span className="t-label-sm text-dirty-grey tabular-nums">
                      {fmtTime(event.ts)}
                    </span>
                    <span className="t-label-sm flex min-w-0 items-center gap-1.5 text-dirty-grey">
                      <span
                        className={clsx(
                          'inline-block size-2 shrink-0 rounded-full',
                          TONE_DOT[event.tone]
                        )}
                      />
                      <span className="truncate">{labelFor(event.source)}</span>
                    </span>
                    <span className={clsx('min-w-0 truncate', TONE_TEXT[event.tone])}>
                      {event.message}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Clipboard>
  )
}
