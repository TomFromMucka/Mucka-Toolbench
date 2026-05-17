import chokidar, { type FSWatcher } from 'chokidar'
import type { WebContents } from 'electron'

/**
 * Non-recursive filesystem watching for the Explorer's open folders.
 *
 * The renderer calls `watchPath(dir)` when the user expands a folder
 * and `unwatchPath(dir)` when they collapse it (or unmount the
 * Explorer). We watch each open directory non-recursively (`depth: 0`)
 * — that gives us VSCode-style immediate updates on what's visible
 * without ever inheriting node_modules' event firehose. If the user
 * expands a child folder, that child gets its own watcher.
 *
 * Events are debounced per-path with a small window — chokidar fires
 * separately for renames (which arrive as unlink + add), so we
 * coalesce a burst into a single `fs:changed` broadcast.
 */

const DEBOUNCE_MS = 200

interface WatchEntry {
  watcher: FSWatcher
  refCount: number
  timer: NodeJS.Timeout | null
}

const watchers = new Map<string, WatchEntry>()
let broadcaster: WebContents | null = null

export function bindFsWatcherBroadcaster(wc: WebContents): void {
  broadcaster = wc
}

export function unbindFsWatcherBroadcaster(): void {
  broadcaster = null
}

function fire(path: string): void {
  if (!broadcaster || broadcaster.isDestroyed()) return
  broadcaster.send('fs:changed', { path })
}

export async function watchPath(path: string): Promise<void> {
  const existing = watchers.get(path)
  if (existing) {
    existing.refCount += 1
    return
  }
  let watcher: FSWatcher
  try {
    watcher = chokidar.watch(path, {
      persistent: true,
      depth: 0,
      ignoreInitial: true,
      // Don't crash if the path disappears mid-watch (e.g. parent
      // folder gets deleted in another worktree); chokidar fires an
      // error event we'll just log.
      ignorePermissionErrors: true,
      followSymlinks: false
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fswatcher] failed to watch', path, err instanceof Error ? err.message : err)
    return
  }
  const entry: WatchEntry = { watcher, refCount: 1, timer: null }
  watcher.on('all', () => {
    if (entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      fire(path)
    }, DEBOUNCE_MS)
  })
  watcher.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[fswatcher]', path, err instanceof Error ? err.message : err)
  })
  watchers.set(path, entry)
}

export async function unwatchPath(path: string): Promise<void> {
  const existing = watchers.get(path)
  if (!existing) return
  existing.refCount -= 1
  if (existing.refCount > 0) return
  if (existing.timer) clearTimeout(existing.timer)
  watchers.delete(path)
  try {
    await existing.watcher.close()
  } catch {
    /* already closed or in teardown — ignore */
  }
}

export async function shutdownAllWatchers(): Promise<void> {
  const toClose = [...watchers.values()]
  watchers.clear()
  await Promise.allSettled(
    toClose.map((entry) => {
      if (entry.timer) clearTimeout(entry.timer)
      return entry.watcher.close()
    })
  )
}
