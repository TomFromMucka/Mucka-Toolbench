import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RoadmapCard, RoadmapColumn } from '@shared/types'
import { COLUMNS } from '../db/roadmap'

/**
 * Mirrors the kanban state into a readable markdown view.
 *
 * The repo is public but all roadmap content is private, so the mirror
 * writes to a git-ignored local file (`ROADMAP.local.md`) — never into
 * the tracked, public MUCKA.md. The sqlite kanban is the source of
 * truth; this is a convenience view for reading the board outside the
 * app. Nothing here reaches git.
 */

const DOC_FILENAME = 'MUCKA.md'
const LOCAL_FILENAME = 'ROADMAP.local.md'

const COLUMN_HEADING: Record<RoadmapColumn, string> = {
  backlog: 'Backlog',
  next: 'Next up',
  doing: 'Doing',
  shipped: 'Shipped',
  parked: 'Parked'
}

function docPath(): string {
  return join(app.getAppPath(), DOC_FILENAME)
}

function localPath(): string {
  return join(app.getAppPath(), LOCAL_FILENAME)
}

function renderSection(cards: RoadmapCard[]): string {
  const byCol = new Map<RoadmapColumn, RoadmapCard[]>()
  for (const col of COLUMNS) byCol.set(col, [])
  for (const c of cards) {
    byCol.get(c.column)?.push(c)
  }
  for (const col of COLUMNS) {
    byCol.get(col)?.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const out: string[] = ['## Roadmap', '']
  for (const col of COLUMNS) {
    const list = byCol.get(col) ?? []
    out.push(`### ${COLUMN_HEADING[col]}`, '')
    if (list.length === 0) {
      out.push('_(empty)_', '')
      continue
    }
    for (const card of list) {
      const tags = card.tags.length > 0 ? ` [${card.tags.join(', ')}]` : ''
      out.push(`- **${card.title}**${tags}`)
      if (card.body.trim().length > 0) {
        for (const line of wrap(card.body.trim(), 70)) {
          out.push(`  ${line}`)
        }
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

function wrap(text: string, width: number): string[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return []
  const words = flat.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line.length === 0) {
      line = w
    } else if (line.length + 1 + w.length <= width) {
      line += ' ' + w
    } else {
      lines.push(line)
      line = w
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

export function mirrorToMarkdown(cards: RoadmapCard[]): void {
  const path = localPath()
  const header =
    '<!-- Private, generated mirror of the cockpit kanban (sqlite).\n' +
    '     git-ignored — do NOT commit. Edit cards in the app, not here. -->\n\n'
  const next = header + renderSection(cards) + '\n'
  let prev = ''
  try {
    if (existsSync(path)) prev = readFileSync(path, 'utf8')
  } catch {
    prev = ''
  }
  writeBackIfChanged(path, prev, next)
}

function writeBackIfChanged(path: string, prev: string, next: string): void {
  if (prev === next) return
  try {
    writeFileSync(path, next, 'utf8')
  } catch {
    /* non-fatal — kanban still works without the mirror */
  }
}

/**
 * One-shot helper: pulls the current `## Roadmap` section from
 * MUCKA.md so the sqlite seeder can import it on first boot.
 */
export function readRoadmapSection(): string {
  const path = docPath()
  if (!existsSync(path)) return ''
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  const lines = text.split(/\r?\n/)
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Roadmap\s*$/i.test(lines[i])) {
      startIdx = i
      break
    }
  }
  if (startIdx < 0) return ''
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i
      break
    }
  }
  return lines.slice(startIdx, endIdx).join('\n')
}
