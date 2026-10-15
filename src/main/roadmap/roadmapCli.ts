import type {
  RoadmapBuildStatus,
  RoadmapCard,
  RoadmapColumn,
  RoadmapDemand
} from '@shared/types'

/**
 * Reading what Mucka Pro's `scripts/roadmap.ts` prints. The board lives in
 * the app's `roadmap_themes` table; the script signs in as a super-admin
 * and goes through the app's own admin route, so no database URL or key
 * reaches the cockpit.
 */

type Rec = Record<string, unknown>

function rec(v: unknown): Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : {}
}

function list(v: unknown): Rec[] {
  return Array.isArray(v) ? v.map(rec) : []
}

function str(row: Rec, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(row: Rec, key: string): number | null {
  const v = row[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function time(row: Rec, key: string): number | null {
  const v = str(row, key)
  const n = v ? Date.parse(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** The app's plan states, as the cockpit names its columns. */
const COLUMN_OF_STATE: Record<string, RoadmapColumn> = {
  oversight: 'oversight',
  todo: 'backlog',
  next: 'next',
  doing: 'doing',
  done: 'shipped',
  wont: 'parked'
}

export const STATE_OF_COLUMN: Record<RoadmapColumn, string> = {
  oversight: 'oversight',
  backlog: 'todo',
  next: 'next',
  doing: 'doing',
  shipped: 'done',
  parked: 'wont'
}

function buildStatus(v: string | null): RoadmapBuildStatus {
  return v === 'partial' || v === 'in_progress' || v === 'built' ? v : 'not_built'
}

export function parseTheme(raw: unknown): RoadmapCard | null {
  const t = rec(raw)
  const id = str(t, 'id')
  const name = str(t, 'name')
  const column = COLUMN_OF_STATE[str(t, 'planState') ?? '']
  if (!id || !name || !column) return null
  const tags = Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : []
  return {
    id,
    title: name,
    body: str(t, 'body') ?? '',
    column,
    tags,
    createdAt: time(t, 'createdAt') ?? 0,
    updatedAt: time(t, 'updatedAt') ?? 0,
    summary: str(t, 'summary'),
    note: str(t, 'note'),
    pr: str(t, 'pr'),
    buildStatus: buildStatus(str(t, 'buildStatus')),
    marketability: num(t, 'marketability'),
    origin: str(t, 'origin') === 'human' ? 'human' : 'oversight',
    accounts: num(t, 'accounts') ?? 0,
    mentions: num(t, 'mentions') ?? 0,
    lastAskedAt: time(t, 'lastAskedAt')
  }
}

export interface RoadmapListing {
  cards: RoadmapCard[]
  demand: Record<string, RoadmapDemand[]>
  unassigned: { findings: number; tickets: number }
}

export function parseListing(parsed: unknown): RoadmapListing {
  const root = rec(parsed)
  if (!Array.isArray(root.themes)) throw new Error('roadmap list had no themes')
  const cards = root.themes.flatMap((t) => parseTheme(t) ?? [])
  const demand: Record<string, RoadmapDemand[]> = {}
  const add = (themeId: string | null, d: RoadmapDemand): void => {
    if (!themeId) return
    ;(demand[themeId] ??= []).push(d)
  }
  for (const f of list(root.findings)) {
    add(str(f, 'themeId'), {
      kind: 'finding',
      summary: str(f, 'summary') ?? '',
      business: str(f, 'businessName'),
      at: time(f, 'occurredAt') ?? 0,
      reference: null
    })
  }
  for (const k of list(root.tickets)) {
    add(str(k, 'themeId'), {
      kind: 'ticket',
      summary: str(k, 'subject') ?? '',
      business: str(k, 'businessName'),
      at: time(k, 'createdAt') ?? 0,
      reference: str(k, 'reference')
    })
  }
  for (const rows of Object.values(demand)) rows.sort((a, b) => b.at - a.at)
  const u = rec(root.unassigned)
  return {
    cards,
    demand,
    unassigned: { findings: num(u, 'findings') ?? 0, tickets: num(u, 'tickets') ?? 0 }
  }
}

/** A write prints `{ theme }`. */
export function parseWritten(parsed: unknown): RoadmapCard {
  const card = parseTheme(rec(parsed).theme)
  if (!card) throw new Error('roadmap.ts did not return the card')
  return card
}

/**
 * The app's own order: most businesses asking first, then mentions, then
 * name, so the cockpit and /admin/roadmap never disagree about what's top.
 */
export function byDemand(a: RoadmapCard, b: RoadmapCard): number {
  return b.accounts - a.accounts || b.mentions - a.mentions || a.title.localeCompare(b.title)
}
