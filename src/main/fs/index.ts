import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { shell } from 'electron'
import type { FsEntry, FsEntryKind, FsListing } from '@shared/types'

function classify(d: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): FsEntryKind {
  if (d.isSymbolicLink()) return 'symlink'
  if (d.isDirectory()) return 'dir'
  if (d.isFile()) return 'file'
  return 'other'
}

const KIND_ORDER: Record<FsEntryKind, number> = {
  dir: 0,
  symlink: 1,
  file: 2,
  other: 3
}

function sortEntries(a: FsEntry, b: FsEntry): number {
  const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (k !== 0) return k
  // Dotfiles after non-dotfiles at the same kind tier.
  if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export async function listDir(input: string): Promise<FsListing> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { path: input ?? '', exists: false, entries: [], error: 'no path' }
  }
  const path = resolve(input)
  try {
    const stat = await fs.stat(path)
    if (!stat.isDirectory()) {
      return { path, exists: true, entries: [], error: 'not a directory' }
    }
    const dirents = await fs.readdir(path, { withFileTypes: true })
    const entries: FsEntry[] = dirents.map((d) => ({
      name: d.name,
      kind: classify(d),
      isHidden: d.name.startsWith('.')
    }))
    entries.sort(sortEntries)
    return { path, exists: true, entries, error: null }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { path, exists: false, entries: [], error: null }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { path, exists: false, entries: [], error: message }
  }
}

export async function revealInOs(path: string): Promise<void> {
  if (typeof path !== 'string' || path.trim().length === 0) return
  shell.showItemInFolder(resolve(path))
}

export async function openPathInOs(path: string): Promise<void> {
  if (typeof path !== 'string' || path.trim().length === 0) return
  const err = await shell.openPath(resolve(path))
  if (err) throw new Error(err)
}
