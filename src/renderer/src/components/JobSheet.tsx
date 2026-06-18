import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Plus, RefreshCw } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import type { PanelSizeProps } from './panelSize'
import { Icon } from './ui/Icon'
import { RoadmapCardModal } from './RoadmapCardModal'

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

export function JobSheet({ size, onResize }: PanelSizeProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('jobs')

  const title = tab === 'jobs' ? 'Job Sheet' : 'Roadmap'
  const subtitle = tab === 'jobs' ? 'recent activity' : 'what’s next'

  return (
    <Clipboard
      title={title}
      subtitle={subtitle}
      className="min-h-0"
      rightSlot={<TabSwitcher value={tab} onChange={setTab} />}
      size={size}
      onResize={onResize}
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

type ModalState =
  | { open: false }
  | { open: true; card: RoadmapCard | null; defaultColumn: RoadmapColumn }

function RoadmapView(): React.JSX.Element {
  const [cards, setCards] = useState<RoadmapCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

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

  const grouped = useMemo(() => {
    const m = new Map<RoadmapColumn, RoadmapCard[]>()
    for (const col of COLUMN_ORDER) m.set(col, [])
    for (const c of cards) m.get(c.column)?.push(c)
    for (const col of COLUMN_ORDER) {
      m.get(col)?.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return m
  }, [cards])

  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const draggedId = String(active.id)
    const dragged = cards.find((c) => c.id === draggedId)
    if (!dragged) return

    const overId = String(over.id)
    const targetColumn = parseColumnFromOverId(overId, cards)
    if (!targetColumn) return

    // Compute target sortOrder.
    const overCard = cards.find((c) => c.id === overId)
    const columnList = grouped.get(targetColumn) ?? []
    let targetSort: number
    if (overCard) {
      // Dropped onto a card — take its slot, others shift down.
      targetSort = overCard.sortOrder
      // Same-column reorder: if we're moving DOWN past the overCard, target
      // is the overCard's slot. Otherwise also overCard's slot. The main
      // moveCard SQL handles re-packing.
    } else {
      // Dropped onto a column container (likely an empty column).
      targetSort = columnList.length
    }

    // No-op when dropping in same column at same slot.
    if (dragged.column === targetColumn && dragged.sortOrder === targetSort) return

    void window.mucka
      .moveRoadmapCard({
        id: draggedId,
        column: targetColumn,
        sortOrder: targetSort
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        void load()
      })
  }

  const openCreate = (col: RoadmapColumn): void => {
    setModal({ open: true, card: null, defaultColumn: col })
  }
  const openCard = (card: RoadmapCard): void => {
    setModal({ open: true, card, defaultColumn: card.column })
  }
  const closeModal = (): void => setModal({ open: false })

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
          {cards.length} cards · drag between columns
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openCreate('backlog')}
            title="New ticket (in Backlog)"
            aria-label="New ticket"
            className="chamfer-sm flex items-center gap-1 px-2 py-0.5"
            style={{
              background: 'var(--orange)',
              color: 'var(--charcoal)',
              fontFamily: 'var(--font-soehne)',
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.02em'
            }}
          >
            <Icon icon={Plus} size={12} strokeWidth={2.5} />
            <span>New</span>
          </button>
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
      </div>

      {loading ? (
        <p className="px-3 py-2 t-body-md text-dirty-grey">Loading…</p>
      ) : error ? (
        <p className="px-3 py-2 t-body-md text-orange">{error}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full min-h-0 gap-2 px-2 py-2">
              {COLUMN_ORDER.map((col) => (
                <KanbanColumn
                  key={col}
                  column={col}
                  cards={grouped.get(col) ?? []}
                  onAdd={() => openCreate(col)}
                  onOpenCard={openCard}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeCard ? <KanbanCardChrome card={activeCard} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <RoadmapCardModal
        open={modal.open}
        card={modal.open ? modal.card : null}
        defaultColumn={modal.open ? modal.defaultColumn : 'backlog'}
        onClose={closeModal}
      />
    </div>
  )
}

function parseColumnFromOverId(
  overId: string,
  cards: RoadmapCard[]
): RoadmapColumn | null {
  if (overId.startsWith('col:')) {
    const c = overId.slice(4)
    return COLUMN_ORDER.includes(c as RoadmapColumn) ? (c as RoadmapColumn) : null
  }
  return cards.find((c) => c.id === overId)?.column ?? null
}

function KanbanColumn({
  column,
  cards,
  onAdd,
  onOpenCard
}: {
  column: RoadmapColumn
  cards: RoadmapCard[]
  onAdd: () => void
  onOpenCard: (card: RoadmapCard) => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column}` })
  return (
    <div
      ref={setNodeRef}
      className="flex h-full min-h-0 w-[200px] shrink-0 flex-col"
      style={{
        background: 'var(--surface2)',
        borderRadius: 6,
        boxShadow: isOver ? 'inset 0 0 0 1.5px var(--orange)' : 'none',
        transition: 'box-shadow 120ms ease'
      }}
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
        <div className="flex items-center gap-1">
          <span
            className="font-mono text-[0.65rem]"
            style={{ color: 'var(--dirty-grey)' }}
          >
            {cards.length}
          </span>
          <button
            type="button"
            onClick={onAdd}
            title={`Add card to ${COLUMN_LABEL[column]}`}
            aria-label={`Add card to ${COLUMN_LABEL[column]}`}
            className="grid size-5 place-items-center rounded-sm transition-colors hover:bg-van-white/15"
            style={{ color: 'var(--dirty-grey)' }}
          >
            <Icon icon={Plus} size={11} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 py-1.5">
          {cards.length === 0 ? (
            <p
              className="px-1 py-3 text-center text-[0.7rem]"
              style={{ color: 'rgba(234, 233, 232, 0.35)' }}
            >
              empty
            </p>
          ) : (
            cards.map((card) => (
              <SortableCard key={card.id} card={card} onOpen={onOpenCard} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

function SortableCard({
  card,
  onOpen
}: {
  card: RoadmapCard
  onOpen: (c: RoadmapCard) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card)}
      role="button"
      tabIndex={0}
      className="cursor-pointer focus:outline-none"
    >
      <KanbanCardChrome card={card} />
    </div>
  )
}

function KanbanCardChrome({
  card,
  dragging = false
}: {
  card: RoadmapCard
  dragging?: boolean
}): React.JSX.Element {
  return (
    <div
      className={clsx('chamfer-sm px-2 py-1.5', dragging && 'rotate-[1.5deg]')}
      style={{
        background: 'var(--surface)',
        color: 'var(--van-white)',
        border: '1px solid var(--border)',
        boxShadow: dragging ? '0 8px 24px rgba(0, 0, 0, 0.55)' : 'none'
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
