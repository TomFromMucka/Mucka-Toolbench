import { promises as fs } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { app, shell } from 'electron'
import type { FilePreview, FsEntry, FsEntryKind, FsListing } from '@shared/types'

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
 * Read a file for the in-app preview modal. The renderer never sees
 * binary blobs — main classifies up front:
 *
 *   - over 2 MB → `too-large` (Tom can still open in default app)
 *   - first 8 KB contains a NUL byte → `binary`
 *   - otherwise → utf-8 decoded text, truncated at 2 MB if needed
 *
 * Allowed anywhere — the preview is read-only, and the explorer lets
 * Tom navigate outside the worktree (e.g. into ~/.mucka-toolbench/)
 * so a home-only gate would block legitimate viewing.
 */
const PREVIEW_CAP_BYTES = 2 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8 * 1024
const IMAGE_CAP_BYTES = 16 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
}

export async function readFilePreview(input: string): Promise<FilePreview> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { kind: 'error', path: input ?? '', message: 'no path' }
  }
  const path = resolve(input)
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) {
      return { kind: 'error', path, message: 'not a file' }
    }
    // Images get a real preview (data URL) — handled before the text caps
    // and the NUL-byte sniff, since image bytes look "binary".
    const mime = IMAGE_MIME[extname(path).toLowerCase()]
    if (mime) {
      if (stat.size > IMAGE_CAP_BYTES) {
        return { kind: 'too-large', path, bytes: stat.size, cap: IMAGE_CAP_BYTES }
      }
      const imgBuf = await fs.readFile(path)
      return {
        kind: 'image',
        path,
        dataUrl: `data:${mime};base64,${imgBuf.toString('base64')}`,
        bytes: stat.size
      }
    }
    if (stat.size > PREVIEW_CAP_BYTES) {
      return { kind: 'too-large', path, bytes: stat.size, cap: PREVIEW_CAP_BYTES }
    }
    const buf = await fs.readFile(path)
    const sniffLen = Math.min(buf.length, BINARY_SNIFF_BYTES)
    for (let i = 0; i < sniffLen; i++) {
      if (buf[i] === 0) {
        return { kind: 'binary', path, bytes: stat.size }
      }
    }
    const text = buf.toString('utf8')
    return {
      kind: 'ok',
      path,
      text,
      bytes: stat.size,
      truncated: false
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { kind: 'missing', path }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', path, message }
  }
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

/**
 * Overwrite a file's text contents. Gated to within the home dir like
 * the other write ops. Used by the in-app editor in the file viewer.
 */
export async function writeTextFile(input: string, content: string): Promise<void> {
  const path = resolve(input)
  ensureWithinHome(path)
  await fs.writeFile(path, content, 'utf8')
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
