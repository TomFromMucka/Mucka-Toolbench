import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { extractDocSection, listDocSections } from './CockpitDoc'

/**
 * Reads PRODUCT.md — the operator's source of truth for what the
 * product is, who it serves, brand voice, current focus, quality bar.
 *
 * The operator can keep their filled-in product doc out of the repo
 * (useful if they've forked the toolbench publicly) by placing it at
 * `~/.mucka-toolbench/PRODUCT.md`. The override is checked first;
 * falls back to the repo-root scaffold when absent.
 *
 * Mirrors CockpitDoc: tiny mtime cache so repeat calls don't re-read,
 * picks up edits whenever the file changes on disk. Mucka pulls this
 * via `get_product_doc` to ground PR reviews + roadmap suggestions.
 */

const DOC_FILENAME = 'PRODUCT.md'

interface CachedDoc {
  mtimeMs: number
  text: string
  path: string
}

let cache: CachedDoc | null = null

function resolveDocPaths(): string[] {
  return [
    join(app.getPath('home'), '.mucka-toolbench', DOC_FILENAME),
    join(app.getAppPath(), DOC_FILENAME)
  ]
}

export interface ProductDocResult {
  text: string
  found: boolean
  mtimeMs: number
}

export function readProductDoc(): ProductDocResult {
  for (const path of resolveDocPaths()) {
    try {
      const stat = statSync(path)
      if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs) {
        return { text: cache.text, found: true, mtimeMs: cache.mtimeMs }
      }
      const text = readFileSync(path, 'utf8')
      cache = { mtimeMs: stat.mtimeMs, text, path }
      return { text, found: true, mtimeMs: stat.mtimeMs }
    } catch {
      /* try next candidate */
    }
  }
  cache = null
  return { text: '', found: false, mtimeMs: 0 }
}

export function listProductSections(text: string): string[] {
  return listDocSections(text)
}

export function extractProductSection(text: string, name: string): string {
  return extractDocSection(text, name)
}
