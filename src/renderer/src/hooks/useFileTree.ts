import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '@shared/types'

type NodeState =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: FsEntry[] }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }

export interface FileTreeApi {
  root: string | null
  /** Map of absolute folder path → its load state. */
  nodes: Map<string, NodeState>
  /** Set of absolute folder paths currently expanded. */
  open: Set<string>
  toggle: (path: string) => void
  /** Force re-fetch of a folder. */
  reload: (path: string) => void
}

function joinPath(parent: string, child: string): string {
  if (parent.endsWith('/')) return parent + child
  return parent + '/' + child
}

export function useFileTree(root: string | null): FileTreeApi {
  const [nodes, setNodes] = useState<Map<string, NodeState>>(() => new Map())
  const [open, setOpen] = useState<Set<string>>(() =>
    root ? new Set([root]) : new Set()
  )
  // React's canonical pattern for "reset state when a prop changes" — track
  // the prior value and re-run setState during render when it differs.
  const [prevRoot, setPrevRoot] = useState<string | null>(root)
  if (prevRoot !== root) {
    setPrevRoot(root)
    setNodes(new Map())
    setOpen(root ? new Set([root]) : new Set())
  }

  const inflightRef = useRef<Set<string>>(new Set())

  const fetchDir = useCallback(async (path: string): Promise<void> => {
    if (inflightRef.current.has(path)) return
    inflightRef.current.add(path)
    setNodes((prev) => {
      const next = new Map(prev)
      next.set(path, { kind: 'loading' })
      return next
    })
    try {
      const result = await window.mucka.listDir(path)
      setNodes((prev) => {
        const next = new Map(prev)
        if (!result.exists) {
          next.set(path, { kind: 'missing' })
        } else if (result.error) {
          next.set(path, { kind: 'error', message: result.error })
        } else {
          next.set(path, { kind: 'ready', entries: result.entries })
        }
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setNodes((prev) => {
        const next = new Map(prev)
        next.set(path, { kind: 'error', message })
        return next
      })
    } finally {
      inflightRef.current.delete(path)
    }
  }, [])

  // Kick off the root fetch whenever the root changes. The microtask
  // hop defers fetchDir's "loading" setState past the effect commit,
  // so React doesn't cascade-render through the synchronous path.
  useEffect(() => {
    if (!root) return
    queueMicrotask(() => {
      void fetchDir(root)
    })
  }, [root, fetchDir])

  const toggle = useCallback(
    (path: string) => {
      setOpen((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
      const isOpening = !open.has(path)
      if (isOpening && !nodes.has(path)) {
        void fetchDir(path)
      }
    },
    [open, nodes, fetchDir]
  )

  const reload = useCallback(
    (path: string) => {
      void fetchDir(path)
    },
    [fetchDir]
  )

  const api = useMemo<FileTreeApi>(
    () => ({ root, nodes, open, toggle, reload }),
    [root, nodes, open, toggle, reload]
  )
  return api
}

export type { NodeState }
export { joinPath }
