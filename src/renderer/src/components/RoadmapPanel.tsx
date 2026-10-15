import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Plus, RefreshCw } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { RoadmapCard, RoadmapColumn, RoadmapState } from '@shared/types'
import { Clipboard } from './Clipboard'
import type { PanelSizeProps } from './panelSize'
import { Icon } from './ui/Icon'
import { RoadmapCardModal } from './RoadmapCardModal'
import { isNewTheme } from './roadmapFormat'

export function RoadmapPanel({ size, onResize }: PanelSizeProps): React.JSX.Element {
  return (
    <Clipboard
      title="Roadmap"
      subtitle="what’s next"
      className="min-h-0"
      size={size}
      onResize={onResize}
    >
      <RoadmapView />
    </Clipboard>
  )
}

/* ─── Roadmap kanban (the Mucka app's board) ──────────────────────────── */

const COLUMN_ORDER: RoadmapColumn[] = [
  'oversight',
  'backlog',
  'next',
  'doing',
  'shipped',
  'parked'
]

const COLUMN_LABEL: Record<RoadmapColumn, string> = {
  oversight: 'Oversight',
  backlog: 'Backlog',
  next: 'Next up',
  doing: 'Doing',
  shipped: 'Shipped',
  parked: 'Parked'
}

// No lane gets the orange: a lane dot is chrome, not Mucka talking.
const COLUMN_ACCENT: Record<RoadmapColumn, string> = {
  oversight: 'var(--pill-scheduled-fg)',
  backlog: 'rgba(234, 233, 232, 0.45)',
  next: 'rgba(234, 233, 232, 0.7)',
  doing: 'var(--van-white)',
  shipped: 'var(--color-status-ok, #5fb35f)',
  parked: 'rgba(234, 233, 232, 0.35)'
}

type ModalState =
  | { open: false }
  | { open: true; card: RoadmapCard | null; defaultColumn: RoadmapColumn }

function RoadmapView(): React.JSX.Element {
  const [state, setState] = useState<RoadmapState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cards = useMemo(() => state?.cards ?? [], [state])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const load = useCallback(async (): Promise<void> => {
    try {
      setState(await window.mucka.getRoadmapState())
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

  // Main hands the cards over in the app's order (most asked-for first).
  const grouped = useMemo(() => {
    const m = new Map<RoadmapColumn, RoadmapCard[]>()
    for (const col of COLUMN_ORDER) m.set(col, [])
    for (const c of cards) m.get(c.column)?.push(c)
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

    // Columns only: the app orders each one by demand, so there's no
    // place within a column to drop into.
    const targetColumn = parseColumnFromOverId(String(over.id), cards)
    if (!targetColumn || targetColumn === dragged.column) return

    setError(null)
    void window.mucka
      .moveRoadmapCard({ id: draggedId, column: targetColumn })
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
        <span
          className="t-label-sm text-dirty-grey"
          title={
            state && (state.unassigned.findings > 0 || state.unassigned.tickets > 0)
              ? `Waiting for tonight's oversight run: ${state.unassigned.findings} findings, ${state.unassigned.tickets} tickets`
              : undefined
          }
        >
          {cards.length} cards · from the Mucka app
          {state?.polledAt
            ? ` · checked ${new Date(state.polledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ''}
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
            onClick={() => void window.mucka.refreshRoadmap()}
            title="Look at the app's roadmap now"
            aria-label="Reload roadmap"
            className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/10"
            style={{ color: 'var(--dirty-grey)' }}
          >
            <Icon icon={RefreshCw} size={12} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {error || state?.error ? (
        <p className="px-3 py-1 t-body-md" style={{ color: 'var(--red)' }}>
          {error ?? state?.error}
          {!error && cards.length > 0 ? ' (showing the last copy)' : ''}
        </p>
      ) : null}
      {loading ? (
        <p className="px-3 py-2 t-body-md text-dirty-grey">Loading…</p>
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
    return COLUMN_ORDER.find((c) => `col:${c}` === overId) ?? null
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
        boxShadow: isOver ? 'inset 0 0 0 1.5px rgba(234, 233, 232, 0.6)' : 'none',
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

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 py-1.5">
        {cards.length === 0 ? (
          <p
            className="px-1 py-3 text-center text-[0.7rem]"
            style={{ color: 'rgba(234, 233, 232, 0.35)' }}
          >
            empty
          </p>
        ) : (
          cards.map((card) => <DraggableCard key={card.id} card={card} onOpen={onOpenCard} />)
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  card,
  onOpen
}: {
  card: RoadmapCard
  onOpen: (c: RoadmapCard) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id
  })
  // The overlay follows the pointer; the card itself stays put, dimmed.
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
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
      <CardFacts card={card} />
      {card.body.trim().length > 0 || card.summary ? (
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
          {card.body.trim() || card.summary}
        </div>
      ) : null}
      {card.tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span
              key={t}
              className="chamfer-sm px-1 py-px text-[0.6rem]"
              style={{
                background: 'rgba(234, 233, 232, 0.10)',
                color: 'var(--van-white)',
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

/** Demand and scoring, as the app's board shows them. Nothing to show for a card nobody has asked for. */
function CardFacts({ card }: { card: RoadmapCard }): React.JSX.Element | null {
  const facts = [
    isNewTheme(card) ? 'New' : null,
    card.accounts > 0 ? `${card.accounts} firm${card.accounts === 1 ? '' : 's'}` : null,
    card.marketability !== null ? `${card.marketability}/10` : null,
    card.pr
  ].filter((f): f is string => f !== null)
  if (facts.length === 0) return null
  return (
    <div
      className="mt-0.5 font-mono text-[0.6rem]"
      style={{ color: 'var(--dirty-grey)' }}
      title={card.accounts > 0 ? `${card.mentions} mentions from ${card.accounts} businesses` : undefined}
    >
      {facts.join(' · ')}
    </div>
  )
}
