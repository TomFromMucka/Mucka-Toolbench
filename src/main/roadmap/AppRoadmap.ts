import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import type {
  RoadmapCard,
  RoadmapCreateInput,
  RoadmapDemand,
  RoadmapMoveInput,
  RoadmapState,
  RoadmapUpdateInput
} from '@shared/types'
import { cardDir } from '../attachments/Attachments'
import { getValue, setValue } from '../db/kv'
import { lastJsonLine, lastLine, loginShell } from '../tickets/ticketCli'
import {
  type RoadmapListing,
  STATE_OF_COLUMN,
  byDemand,
  parseListing,
  parseWritten
} from './roadmapCli'

/** The board changes a few times a day; five minutes matches the ticket poll. */
const POLL_MS = 5 * 60_000
const CACHE_KEY = 'roadmap.app'
const SCRIPT = 'npx tsx scripts/roadmap.ts'

export interface AppRoadmapDeps {
  /** The read-only Mucka Pro checkout. The ticket poll keeps it on the latest main. */
  scoutDir: () => Promise<string>
  /** Environment for launched commands, without the cockpit's secrets. */
  env: () => NodeJS.ProcessEnv
  /** The board changed: tell the renderer and rewrite the markdown mirror. */
  changed: (cards: RoadmapCard[]) => void
}

interface Cache extends RoadmapListing {
  polledAt: number | null
}

function readCache(): Cache {
  const empty: Cache = { cards: [], demand: {}, unassigned: { findings: 0, tickets: 0 }, polledAt: null }
  const raw = getValue(CACHE_KEY)
  if (!raw) return empty
  try {
    const parsed: unknown = JSON.parse(raw)
    const listing = parseListing(parsed)
    const at =
      typeof parsed === 'object' && parsed !== null && 'polledAt' in parsed
        ? parsed.polledAt
        : null
    return { ...listing, polledAt: typeof at === 'number' ? at : null }
  } catch {
    return empty
  }
}

/**
 * The roadmap kanban, which lives in the Mucka app at /admin/roadmap. Every
 * read and write goes through Mucka Pro's `scripts/roadmap.ts`, the way
 * support tickets go through `ticket.ts`.
 *
 * The last good listing is kept in sqlite so the board and Mucka's tools
 * have something to show at boot and when the app can't be reached. Writes
 * land on the app first and the copy follows, except a move, which shows at
 * once (a dragged card snapping back for ten seconds reads as a failure)
 * and is put back if the app refuses it.
 */
export class AppRoadmap {
  private readonly deps: AppRoadmapDeps
  private cache: Cache = readCache()
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private again = false

  constructor(deps: AppRoadmapDeps) {
    this.deps = deps
  }

  start(): void {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  refresh(): void {
    void this.poll()
  }

  state(): RoadmapState {
    return {
      cards: this.cards(),
      error: this.error,
      polledAt: this.cache.polledAt,
      unassigned: this.cache.unassigned
    }
  }

  cards(): RoadmapCard[] {
    return [...this.cache.cards].sort(byDemand)
  }

  demand(id: string): RoadmapDemand[] {
    const card = this.find(id)
    return card ? (this.cache.demand[card.id] ?? []) : []
  }

  /**
   * By id, or by a unique prefix of one: Mucka passes the short ids she
   * sees in list_roadmap, and uuids are noisy in a voice transcript.
   */
  find(id: string): RoadmapCard | null {
    const want = id.trim()
    const exact = this.cache.cards.find((c) => c.id === want)
    if (exact) return exact
    if (want.length < 4) return null
    const matches = this.cache.cards.filter((c) => c.id.startsWith(want))
    return matches.length === 1 ? matches[0] : null
  }

  async create(input: RoadmapCreateInput): Promise<RoadmapCard> {
    const title = input.title.trim()
    if (!title) throw new Error('title must not be empty')
    const flags = ['--name "$RM_NAME"', '--state "$RM_STATE"']
    const env: Record<string, string> = { RM_NAME: title, RM_STATE: STATE_OF_COLUMN[input.column] }
    if (input.body?.trim()) {
      flags.push('--body "$RM_BODY"')
      env.RM_BODY = input.body
    }
    if (input.tags && input.tags.length > 0) {
      flags.push('--tags "$RM_TAGS"')
      env.RM_TAGS = input.tags.join(',')
    }
    let card = await this.write(`create ${flags.join(' ')}`, env)
    if (input.draftId && input.draftId !== card.id) card = await this.adoptDraft(input.draftId, card)
    this.put(card)
    return card
  }

  async update(input: RoadmapUpdateInput): Promise<RoadmapCard> {
    const current = this.found(input.id)
    const flags: string[] = []
    const env: Record<string, string> = { RM_ID: current.id }
    if (input.title !== undefined) {
      if (!input.title.trim()) throw new Error('title must not be empty')
      flags.push('--name "$RM_NAME"')
      env.RM_NAME = input.title.trim()
    }
    if (input.body !== undefined) {
      flags.push('--body "$RM_BODY"')
      env.RM_BODY = input.body
    }
    if (input.tags !== undefined) {
      flags.push('--tags "$RM_TAGS"')
      env.RM_TAGS = input.tags.join(',')
    }
    if (flags.length === 0) return current
    const card = await this.write(`update "$RM_ID" ${flags.join(' ')}`, env)
    this.put(card)
    return card
  }

  async move(input: RoadmapMoveInput): Promise<RoadmapCard> {
    const current = this.found(input.id)
    if (current.column === input.column) return current
    this.put({ ...current, column: input.column })
    try {
      const card = await this.write('move "$RM_ID" "$RM_STATE"', {
        RM_ID: current.id,
        RM_STATE: STATE_OF_COLUMN[input.column]
      })
      this.put(card)
      return card
    } catch (err) {
      this.put(current)
      throw err
    }
  }

  /** Only cards a person added: an agent theme is parked instead, or the night re-proposes it. */
  async delete(id: string): Promise<boolean> {
    const current = this.find(id)
    if (!current) return false
    if (current.origin !== 'human') {
      throw new Error("Oversight themes can't be deleted; park it instead.")
    }
    await this.run('delete "$RM_ID"', { RM_ID: current.id })
    this.cache = { ...this.cache, cards: this.cache.cards.filter((c) => c.id !== current.id) }
    this.save()
    return true
  }

  private found(id: string): RoadmapCard {
    const card = this.find(id)
    if (!card) throw new Error(`unknown card: ${id}`)
    return card
  }

  /**
   * Images pasted while a card was being written are filed under an id the
   * modal made up; the app gives the card its own. Move them across and
   * point the body's links at the new folder.
   */
  private async adoptDraft(draftId: string, card: RoadmapCard): Promise<RoadmapCard> {
    let from: string
    try {
      from = cardDir(draftId)
    } catch {
      return card
    }
    if (!existsSync(from)) return card
    await rename(from, cardDir(card.id))
    const body = card.body.split(`mucka-asset://${draftId}/`).join(`mucka-asset://${card.id}/`)
    if (body === card.body) return card
    return this.write('update "$RM_ID" --body "$RM_BODY"', { RM_ID: card.id, RM_BODY: body })
  }

  private async write(args: string, env: Record<string, string>): Promise<RoadmapCard> {
    return parseWritten(await this.run(args, env))
  }

  private async run(args: string, env: Record<string, string>): Promise<unknown> {
    const dir = await this.deps.scoutDir()
    try {
      const out = await loginShell(dir, `${SCRIPT} ${args} --json`, { ...this.deps.env(), ...env })
      return lastJsonLine(out)
    } catch (err) {
      throw new Error(`Mucka app roadmap: ${lastLine(err)}`)
    }
  }

  /**
   * A write answers with the card but not its demand (the app doesn't
   * recount on an edit), so the counts already held are kept.
   */
  private put(card: RoadmapCard): void {
    const held = this.cache.cards.find((c) => c.id === card.id)
    const next = held
      ? { ...card, accounts: held.accounts, mentions: held.mentions, lastAskedAt: held.lastAskedAt }
      : card
    const others = this.cache.cards.filter((c) => c.id !== card.id)
    this.cache = { ...this.cache, cards: [...others, next] }
    this.save()
  }

  private save(): void {
    try {
      setValue(CACHE_KEY, JSON.stringify(this.toPayload()))
    } catch {
      // The copy is a convenience; the app still has the board.
    }
    this.deps.changed(this.cards())
  }

  /** Stored in the shape the script prints, so one parser reads both. */
  private toPayload(): unknown {
    return {
      themes: this.cache.cards.map((c) => ({
        id: c.id,
        name: c.title,
        body: c.body || null,
        tags: c.tags,
        planState: STATE_OF_COLUMN[c.column],
        createdAt: new Date(c.createdAt).toISOString(),
        updatedAt: new Date(c.updatedAt).toISOString(),
        summary: c.summary,
        note: c.note,
        pr: c.pr,
        buildStatus: c.buildStatus,
        marketability: c.marketability,
        origin: c.origin,
        accounts: c.accounts,
        mentions: c.mentions,
        lastAskedAt: c.lastAskedAt ? new Date(c.lastAskedAt).toISOString() : null
      })),
      findings: Object.entries(this.cache.demand).flatMap(([themeId, rows]) =>
        rows
          .filter((d) => d.kind === 'finding')
          .map((d) => ({
            themeId,
            summary: d.summary,
            businessName: d.business,
            occurredAt: new Date(d.at).toISOString()
          }))
      ),
      tickets: Object.entries(this.cache.demand).flatMap(([themeId, rows]) =>
        rows
          .filter((d) => d.kind === 'ticket')
          .map((d) => ({
            themeId,
            subject: d.summary,
            businessName: d.business,
            createdAt: new Date(d.at).toISOString(),
            reference: d.reference
          }))
      ),
      unassigned: this.cache.unassigned,
      polledAt: this.cache.polledAt
    }
  }

  private async poll(): Promise<void> {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      const listing = parseListing(await this.run('list', {}))
      this.cache = { ...listing, polledAt: Date.now() }
      this.error = null
      this.save()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.deps.changed(this.cards())
    } finally {
      this.busy = false
    }
    if (this.again) {
      this.again = false
      void this.poll()
    }
  }
}
