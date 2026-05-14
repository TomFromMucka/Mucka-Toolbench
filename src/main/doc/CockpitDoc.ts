import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Reads MUCKA.md — the cockpit's living spec — from the project root.
 *
 * Mucka pulls this on demand via the `get_cockpit_doc` tool, so we keep
 * a tiny mtime cache to avoid re-reading from disk on repeat calls but
 * pick up edits as soon as someone saves the file.
 */

const DOC_FILENAME = 'MUCKA.md'

interface CachedDoc {
  mtimeMs: number
  text: string
}

let cache: CachedDoc | null = null

function resolveDocPath(): string {
  // app.getAppPath() returns the project root in dev and the asar root
  // in a packaged build. MUCKA.md sits at the repo root in both cases
  // (we'll need to copy it into resources when we ever ship a DMG).
  return join(app.getAppPath(), DOC_FILENAME)
}

export interface CockpitDocResult {
  /** Resolved content. Empty string when the doc file is missing. */
  text: string
  /** True when the file was readable; false when missing or unreadable. */
  found: boolean
  /** ms timestamp of the file on disk (0 when missing). */
  mtimeMs: number
}

/**
 * Read the whole doc. Caches by mtime — re-reads only when the file
 * on disk has changed since the last call.
 */
export function readCockpitDoc(): CockpitDocResult {
  const path = resolveDocPath()
  try {
    const stat = statSync(path)
    if (cache && cache.mtimeMs === stat.mtimeMs) {
      return { text: cache.text, found: true, mtimeMs: cache.mtimeMs }
    }
    const text = readFileSync(path, 'utf8')
    cache = { mtimeMs: stat.mtimeMs, text }
    return { text, found: true, mtimeMs: stat.mtimeMs }
  } catch {
    cache = null
    return { text: '', found: false, mtimeMs: 0 }
  }
}

/**
 * Pull a single `## Heading` section by name (case-insensitive,
 * whitespace-tolerant). Returns the heading line + the body up to (but
 * not including) the next `## ` heading. When `name` doesn't match,
 * returns an empty string and the caller can decide what to do.
 */
export function extractDocSection(text: string, name: string): string {
  const target = name.trim().toLowerCase()
  if (!target) return ''
  const lines = text.split(/\r?\n/)
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/)
    if (m && m[1].trim().toLowerCase() === target) {
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
  return lines.slice(startIdx, endIdx).join('\n').trim()
}

/** Top-level `## Heading` names, in document order. */
export function listDocSections(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) out.push(m[1].trim())
  }
  return out
}
