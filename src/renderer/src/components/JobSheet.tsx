import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import type {
  JobEvent,
  JobEventSource,
  JobEventTone,
  RoadmapCard,
  RoadmapColumn
} from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { useEventsState } from '../state/EventsContext'
import { Clipboard } from './Clipboard'
import { Icon } from './ui/Icon'

type Tab = 'jobs' | 'roadmap'

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
  const [tab, setTab] = useState<Tab>('jobs')

  const title = tab === 'jobs' ? 'Job Sheet' : 'Roadmap'
  const subtitle = tab === 'jobs' ? 'recent activity' : 'what’s next'

  return (
    <Clipboard
      title={title}
      subtitle={subtitle}
      className="min-h-0"
      rightSlot={<TabSwitcher value={tab} onChange={setTab} />}
    >
      {tab === 'jobs' ? <JobsView /> : <RoadmapView />}
    </Clipboard>
  )
}

function TabSwitcher({
  value,
  onChange
}: {
  value: Tab
  onChange: (t: Tab) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <TabPill active={value === 'jobs'} onClick={() => onChange('jobs')}>
        Jobs
      </TabPill>
      <TabPill active={value === 'roadmap'} onClick={() => onChange('roadmap')}>
        Roadmap
      </TabPill>
    </div>
  )
}

function TabPill({
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
      className="chamfer-sm t-label-sm px-2 py-0.5 transition-colors"
      style={{
        fontFamily: 'var(--font-soehne)',
        textTransform: 'none',
        letterSpacing: '0.01em',
        background: active ? 'var(--orange)' : 'rgba(234, 233, 232, 0.10)',
        color: active ? 'var(--charcoal)' : 'rgba(234, 233, 232, 0.85)',
        fontWeight: active ? 500 : 400
      }}
    >
      {children}
    </button>
  )
}

/* ─── Jobs ────────────────────────────────────────────────────────────── */

function JobsView(): React.JSX.Element {
  const { agents } = useAgentsState()
  const { events, loading } = useEventsState()

  const labelFor = (source: JobEventSource): string => {
    if (source === 'mucka') return 'mucka'
    if (source === 'system') return 'system'
    const a = agents.find((x) => x.id === source)
    return a ? a.displayName.toLowerCase() : String(source)
  }

  return (
    <div
      className="h-full min-h-0 overflow-y-auto px-3 py-2"
      style={{ background: 'var(--surface)' }}
    >
      {loading ? (
        <p className="t-body-md text-dirty-grey">Loading…</p>
      ) : events.length === 0 ? (
        <p className="t-body-md text-dirty-grey">
          No activity yet — events appear as Vercel deploys move, PRs open, and
          Mucka makes changes.
        </p>
      ) : (
        <ol className="space-y-[2px]">
          {events.map((event: JobEvent, idx) => {
            const prevTs = idx > 0 ? events[idx - 1]?.ts ?? null : null
            const day = fmtDayBreak(prevTs, event.ts)
            return (
              <li key={event.id}>
                {day ? (
                  <div className="t-label-sm mt-3 mb-1 text-dirty-grey">{day}</div>
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
  )
}

/* ─── Roadmap kanban (sqlite-backed) ──────────────────────────────────── */

const COLUMN_ORDER: RoadmapColumn[] = ['backlog', 'next', 'doing', 'shipped', 'parked']

const COLUMN_LABEL: Record<RoadmapColumn, string> = {
  backlog: 'Backlog',
  next: 'Next up',
  doing: 'Doing',
  shipped: 'Shipped',
  parked: 'Parked'
}

const COLUMN_ACCENT: Record<RoadmapColumn, string> = {
  backlog: 'rgba(234, 233, 232, 0.45)',
  next: 'var(--orange)',
  doing: 'var(--orange)',
  shipped: 'var(--color-status-ok, #5fb35f)',
  parked: 'rgba(234, 233, 232, 0.35)'
}

function RoadmapView(): React.JSX.Element {
  const [cards, setCards] = useState<RoadmapCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const next = await window.mucka.listRoadmap()
      setCards(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const off = window.mucka.onRoadmapUpdate(() => {
      void load()
    })
    return off
  }, [load])

  const grouped = new Map<RoadmapColumn, RoadmapCard[]>()
  for (const col of COLUMN_ORDER) grouped.set(col, [])
  for (const c of cards) grouped.get(c.column)?.push(c)
  for (const col of COLUMN_ORDER) {
    grouped.get(col)?.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ background: 'var(--surface)' }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface2)'
        }}
      >
        <span className="t-label-sm text-dirty-grey">
          {cards.length} cards · drag + edit landing next slice
        </span>
        <button
          type="button"
          onClick={() => void load()}
          title="Reload roadmap"
          aria-label="Reload roadmap"
          className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/10"
          style={{ color: 'var(--dirty-grey)' }}
        >
          <Icon icon={RefreshCw} size={12} strokeWidth={2.25} />
        </button>
      </div>

      {loading ? (
        <p className="px-3 py-2 t-body-md text-dirty-grey">Loading…</p>
      ) : error ? (
        <p className="px-3 py-2 t-body-md text-orange">{error}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full min-h-0 gap-2 px-2 py-2">
            {COLUMN_ORDER.map((col) => (
              <KanbanColumn
                key={col}
                column={col}
                cards={grouped.get(col) ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KanbanColumn({
  column,
  cards
}: {
  column: RoadmapColumn
  cards: RoadmapCard[]
}): React.JSX.Element {
  return (
    <div
      className="flex h-full min-h-0 w-[180px] shrink-0 flex-col"
      style={{ background: 'var(--surface2)', borderRadius: 6 }}
    >
      <div
        className="flex items-center justify-between border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: COLUMN_ACCENT[column] }}
          />
          <span
            className="truncate"
            style={{
              fontFamily: 'var(--font-soehne-breit)',
              fontWeight: 500,
              fontSize: '11px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--van-white)'
            }}
          >
            {COLUMN_LABEL[column]}
          </span>
        </div>
        <span
          className="font-mono text-[0.65rem]"
          style={{ color: 'var(--dirty-grey)' }}
        >
          {cards.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 py-1.5">
        {cards.length === 0 ? (
          <p
            className="px-1 py-3 text-center text-[0.7rem]"
            style={{ color: 'rgba(234, 233, 232, 0.35)' }}
          >
            empty
          </p>
        ) : (
          cards.map((card) => <KanbanCard key={card.id} card={card} />)
        )}
      </div>
    </div>
  )
}

function KanbanCard({ card }: { card: RoadmapCard }): React.JSX.Element {
  return (
    <div
      className="chamfer-sm px-2 py-1.5"
      style={{
        background: 'var(--surface)',
        color: 'var(--van-white)',
        border: '1px solid var(--border)'
      }}
    >
      <div
        className="leading-snug"
        style={{
          fontFamily: 'var(--font-soehne)',
          fontWeight: 500,
          fontSize: '12px'
        }}
      >
        {card.title}
      </div>
      {card.body.trim().length > 0 ? (
        <div
          className="mt-1 leading-snug"
          style={{
            fontFamily: 'var(--font-soehne)',
            fontSize: '11px',
            color: 'var(--dirty-grey)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {card.body}
        </div>
      ) : null}
      {card.tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span
              key={t}
              className="chamfer-sm px-1 py-px text-[0.6rem]"
              style={{
                background: 'rgba(255, 78, 0, 0.18)',
                color: 'var(--orange)',
                fontFamily: 'var(--font-soehne)'
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
