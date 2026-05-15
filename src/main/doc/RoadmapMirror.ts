import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RoadmapCard, RoadmapColumn } from '@shared/types'
import { COLUMNS } from '../db/roadmap'

/**
 * Mirrors the kanban state into MUCKA.md's `## Roadmap` section so the
 * markdown spec stays in sync with sqlite. The kanban is the source of
 * truth; this writes a derived view that git can see.
 */

const DOC_FILENAME = 'MUCKA.md'

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
  const path = docPath()
  if (!existsSync(path)) return
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  const lines = text.split(/\r?\n/)
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Roadmap\s*$/i.test(lines[i])) {
      startIdx = i
      break
    }
  }
  const newBlock = renderSection(cards).split(/\r?\n/)

  if (startIdx < 0) {
    // No existing section — append at end with a leading blank line.
    const next = [...lines]
    while (next.length > 0 && next[next.length - 1].trim() === '') next.pop()
    next.push('', ...newBlock)
    writeBackIfChanged(path, text, next.join('\n'))
    return
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i
      break
    }
  }

  // Drop trailing blank lines inside the old section so the spacing
  // before the next `## ` heading stays consistent.
  while (endIdx > startIdx + 1 && lines[endIdx - 1].trim() === '') endIdx--

  const before = lines.slice(0, startIdx)
  const after = lines.slice(endIdx)
  const next = [...before, ...newBlock, ...after].join('\n')
  writeBackIfChanged(path, text, next)
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
