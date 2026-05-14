import clsx from 'clsx'
import type { JobEvent, JobEventSource, JobEventTone } from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { useEventsState } from '../state/EventsContext'
import { Clipboard } from './Clipboard'

const TONE_TEXT: Record<JobEventTone, string> = {
  normal: 'text-ink',
  attention: 'text-mucka-deep font-semibold',
  win: 'text-status-ok',
  bad: 'text-status-bad'
}

const TONE_DOT: Record<JobEventTone, string> = {
  normal: 'bg-ink-faint',
  attention: 'bg-mucka',
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
      paper="lined"
      className="min-h-0"
      rightSlot={
        <span className="text-[0.65rem] uppercase tracking-wide text-paper-cream/70">
          {events.length}
        </span>
      }
    >
      <div className="h-full min-h-0 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="font-[var(--font-hand)] text-[0.88rem] text-ink-faint">
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="font-[var(--font-hand)] text-[0.88rem] text-ink-faint">
            No activity yet — events appear as Vercel deploys move, PRs open,
            and Mucka makes changes.
          </p>
        ) : (
          <ol className="space-y-[2px]">
            {events.map((event: JobEvent, idx) => {
              const prevTs = idx > 0 ? events[idx - 1]?.ts ?? null : null
              const day = fmtDayBreak(prevTs, event.ts)
              return (
                <li key={event.id} className="font-[var(--font-hand)]">
                  {day ? (
                    <div className="mt-3 mb-1 text-[0.62rem] uppercase tracking-[0.16em] text-ink-faint font-sans">
                      {day}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[44px_64px_1fr] items-baseline gap-2 text-[0.92rem] leading-[26px]">
                    <span className="text-ink-faint font-sans text-[0.7rem] tabular-nums">
                      {fmtTime(event.ts)}
                    </span>
                    <span className="flex items-center gap-1.5 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
                      <span
                        className={clsx(
                          'inline-block size-2 rounded-full',
                          TONE_DOT[event.tone]
                        )}
                      />
                      {labelFor(event.source)}
                    </span>
                    <span className={clsx('truncate', TONE_TEXT[event.tone])}>
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
