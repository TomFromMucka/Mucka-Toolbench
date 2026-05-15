import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { extractDocSection, listDocSections } from './CockpitDoc'

/**
 * Reads PRODUCT.md — Tom's source of truth for what Mucka (the product)
 * is, who it serves, brand voice, current focus, quality bar.
 *
 * Mirrors CockpitDoc: tiny mtime cache so repeat calls don't re-read,
 * picks up edits whenever the file changes on disk. Mucka pulls this
 * via `get_product_doc` to ground PR reviews + roadmap suggestions.
 */

const DOC_FILENAME = 'PRODUCT.md'

interface CachedDoc {
  mtimeMs: number
  text: string
}

let cache: CachedDoc | null = null

function resolveDocPath(): string {
  return join(app.getAppPath(), DOC_FILENAME)
}

export interface ProductDocResult {
  text: string
  found: boolean
  mtimeMs: number
}

export function readProductDoc(): ProductDocResult {
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

export function listProductSections(text: string): string[] {
  return listDocSections(text)
}

export function extractProductSection(text: string, name: string): string {
  return extractDocSection(text, name)
}
