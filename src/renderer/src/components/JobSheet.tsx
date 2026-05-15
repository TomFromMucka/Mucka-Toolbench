import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import type { JobEvent, JobEventSource, JobEventTone } from '@shared/types'
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

/* ─── Roadmap (pulled from MUCKA.md → ## Roadmap) ─────────────────────── */

type Block =
  | { kind: 'h3'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string }

function parseRoadmap(raw: string): Block[] {
  const lines = raw.split(/\r?\n/)
  // Drop the leading `## Roadmap` line — the Clipboard header already
  // labels this view.
  const stripped = lines
    .filter((l, i) => !(i === 0 && /^##\s+/.test(l)))

  const blocks: Block[] = []
  let currentBullet: string | null = null
  let currentPara: string | null = null

  const flushBullet = (): void => {
    if (currentBullet !== null) {
      blocks.push({ kind: 'bullet', text: stripInline(currentBullet.trim()) })
      currentBullet = null
    }
  }
  const flushPara = (): void => {
    if (currentPara !== null) {
      const text = currentPara.trim()
      if (text.length > 0) blocks.push({ kind: 'para', text: stripInline(text) })
      currentPara = null
    }
  }

  for (const line of stripped) {
    if (line.trim().length === 0) {
      flushBullet()
      flushPara()
      continue
    }
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h3) {
      flushBullet()
      flushPara()
      blocks.push({ kind: 'h3', text: h3[1] })
      continue
    }
    const bullet = line.match(/^\s*-\s+(.+)$/)
    if (bullet) {
      flushBullet()
      flushPara()
      currentBullet = bullet[1]
      continue
    }
    // Continuation: indented under the current bullet (the file wraps
    // bullets with a 2-space indent).
    if (/^\s{2,}/.test(line) && currentBullet !== null) {
      currentBullet += ' ' + line.trim()
      continue
    }
    // Otherwise: free paragraph (rare in Roadmap, but handle it).
    flushBullet()
    if (currentPara === null) currentPara = line.trim()
    else currentPara += ' ' + line.trim()
  }
  flushBullet()
  flushPara()
  return blocks
}

/** Cheap markdown-to-plain pass — drops `**`, `` ` ``, `[text](url)` decoration. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

function RoadmapView(): React.JSX.Element {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const payload = await window.mucka.getCockpitDoc('Roadmap')
      if (!payload.found) {
        setError('Roadmap section not found in MUCKA.md.')
        setText('')
      } else {
        setText(payload.text)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const blocks = parseRoadmap(text)

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
        <span className="t-label-sm text-dirty-grey">from MUCKA.md</span>
        <button
          type="button"
          onClick={() => void load()}
          title="Reload Roadmap from MUCKA.md"
          aria-label="Reload Roadmap"
          className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/10"
          style={{ color: 'var(--dirty-grey)' }}
        >
          <Icon icon={RefreshCw} size={12} strokeWidth={2.25} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="t-body-md text-dirty-grey">Loading…</p>
        ) : error ? (
          <p className="t-body-md text-orange">{error}</p>
        ) : blocks.length === 0 ? (
          <p className="t-body-md text-dirty-grey">Roadmap is empty.</p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <BlockView key={i} block={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BlockView({ block }: { block: Block }): React.JSX.Element {
  if (block.kind === 'h3') {
    return (
      <h3
        className="mt-3 mb-1"
        style={{
          fontFamily: 'var(--font-soehne-breit)',
          fontWeight: 500,
          fontSize: '13px',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--orange)'
        }}
      >
        {block.text}
      </h3>
    )
  }
  if (block.kind === 'bullet') {
    return (
      <div className="flex items-start gap-2 t-body-md leading-snug">
        <span
          className="mt-[8px] inline-block size-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--dirty-grey)' }}
        />
        <span className="text-van-white">{block.text}</span>
      </div>
    )
  }
  return (
    <p className="t-body-md leading-snug text-dirty-grey">{block.text}</p>
  )
}
