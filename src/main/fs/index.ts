import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app, shell } from 'electron'
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

/**
 * Safety gate for write operations. Anything inside the user's home
 * directory is allowed (covers every worktree Tom would point an agent
 * at). Anything outside (system paths, /tmp's parent, etc.) is denied
 * so a slip in the renderer can't trash the OS.
 */
function ensureWithinHome(absolutePath: string): void {
  const home = app.getPath('home')
  const homeAbs = resolve(home)
  const target = resolve(absolutePath)
  if (target === homeAbs) return
  if (!target.startsWith(homeAbs + '/')) {
    throw new Error(`refusing to touch path outside home: ${target}`)
  }
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('name must not be empty')
  if (trimmed === '.' || trimmed === '..') throw new Error('invalid name')
  if (trimmed.includes('/')) throw new Error('name must not contain `/`')
  if (trimmed.includes('\0')) throw new Error('name must not contain null byte')
  return trimmed
}

export async function createFile(parentPath: string, name: string): Promise<string> {
  const parent = resolve(parentPath)
  ensureWithinHome(parent)
  const base = validateName(name)
  const full = join(parent, base)
  // wx flag — fail if file exists, so we don't silently overwrite.
  await fs.writeFile(full, '', { flag: 'wx' })
  return full
}

export async function createFolder(parentPath: string, name: string): Promise<string> {
  const parent = resolve(parentPath)
  ensureWithinHome(parent)
  const base = validateName(name)
  const full = join(parent, base)
  await fs.mkdir(full)
  return full
}

export async function renamePath(
  fromPath: string,
  toName: string
): Promise<string> {
  const from = resolve(fromPath)
  ensureWithinHome(from)
  const base = validateName(toName)
  const to = join(dirname(from), base)
  ensureWithinHome(to)
  // Refuse to clobber an existing entry — caller confirms via UI before
  // calling, but defensive.
  try {
    await fs.access(to)
    throw new Error(`a file or folder named "${base}" already exists here`)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
  await fs.rename(from, to)
  return to
}

export async function deletePath(path: string): Promise<void> {
  const target = resolve(path)
  ensureWithinHome(target)
  // Extra-paranoid: never delete the home directory itself.
  if (target === resolve(app.getPath('home'))) {
    throw new Error('refusing to delete the home directory')
  }
  await fs.rm(target, { recursive: true, force: true })
}
