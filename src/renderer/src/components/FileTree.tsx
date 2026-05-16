import { useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FsEntry } from '@shared/types'
import { Icon } from './ui/Icon'
import { joinPath, type FileTreeApi } from '../hooks/useFileTree'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'

interface FileTreeProps {
  api: FileTreeApi
}

const ROW_PAD_LEFT = 8
const INDENT_PER_LEVEL = 12

/* ─── Path helpers ───────────────────────────────────────────────────── */

function parentOf(p: string): string {
  const idx = p.lastIndexOf('/')
  if (idx <= 0) return '/'
  return p.slice(0, idx)
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(idx + 1) : p
}

function relativeTo(absolute: string, root: string | null): string {
  if (!root || absolute === root) return basename(absolute)
  if (absolute.startsWith(root + '/')) return absolute.slice(root.length + 1)
  return absolute
}

/* ─── Right-click target ─────────────────────────────────────────────── */

interface MenuTarget {
  x: number
  y: number
  path: string
  isDir: boolean
  /** Folder to refresh after a mutation lands. */
  refreshPath: string
}

/* ─── Tree root ──────────────────────────────────────────────────────── */

export function FileTree({ api }: FileTreeProps): React.JSX.Element {
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  if (!api.root) {
    return (
      <p className="px-3 py-3 t-body-md" style={{ color: 'var(--dirty-grey)' }}>
        Select a worktree to browse files.
      </p>
    )
  }

  const openMenuFor = (e: React.MouseEvent, path: string, isDir: boolean): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      path,
      isDir,
      refreshPath: isDir ? path : parentOf(path)
    })
  }

  // Right-click on the empty area (gaps between rows / below tree) opens
  // a menu rooted at the tree's root path.
  const openRootMenu = (e: React.MouseEvent): void => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    if (!api.root) return
    setMenu({
      x: e.clientX,
      y: e.clientY,
      path: api.root,
      isDir: true,
      refreshPath: api.root
    })
  }

  return (
    <div onContextMenu={openRootMenu}>
      <FolderBody
        path={api.root}
        depth={0}
        api={api}
        onContextMenu={openMenuFor}
      />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={buildEntries(menu, api)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

/* ─── Folder rendering ───────────────────────────────────────────────── */

function FolderBody({
  path,
  depth,
  api,
  onContextMenu
}: {
  path: string
  depth: number
  api: FileTreeApi
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void
}): React.JSX.Element | null {
  const state = api.nodes.get(path)
  if (!state) return null
  if (state.kind === 'loading') {
    return <RowStub depth={depth + 1} label="Loading…" tone="dirty" />
  }
  if (state.kind === 'missing') {
    return <RowStub depth={depth + 1} label="(missing)" tone="dirty" />
  }
  if (state.kind === 'error') {
    return <RowStub depth={depth + 1} label={state.message} tone="bad" />
  }
  if (state.entries.length === 0) {
    return <RowStub depth={depth + 1} label="(empty)" tone="dirty" />
  }
  return (
    <>
      {state.entries.map((entry) => (
        <TreeRow
          key={entry.name}
          parent={path}
          entry={entry}
          depth={depth + 1}
          api={api}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  )
}

function TreeRow({
  parent,
  entry,
  depth,
  api,
  onContextMenu
}: {
  parent: string
  entry: FsEntry
  depth: number
  api: FileTreeApi
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void
}): React.JSX.Element {
  const path = joinPath(parent, entry.name)
  const isDir = entry.kind === 'dir' || entry.kind === 'symlink'
  const open = isDir && api.open.has(path)
  const indent = ROW_PAD_LEFT + depth * INDENT_PER_LEVEL

  const handleClick = (): void => {
    if (isDir) {
      api.toggle(path)
    } else {
      void window.mucka.openPathInOs(path)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, path, isDir)}
        title={path}
        className="group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left transition-colors hover:bg-orange/10"
        style={{
          paddingLeft: `${indent}px`,
          color: entry.isHidden
            ? 'rgba(234, 233, 232, 0.5)'
            : 'var(--van-white)'
        }}
      >
        {isDir ? (
          <Icon
            icon={open ? ChevronDown : ChevronRight}
            size={12}
            strokeWidth={2.25}
            className="shrink-0 opacity-70"
          />
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}
        <Icon
          icon={isDir ? (open ? FolderOpen : Folder) : File}
          size={14}
          strokeWidth={2.25}
          className="shrink-0"
          style={{
            color: isDir ? 'var(--orange)' : 'rgba(234, 233, 232, 0.6)'
          }}
        />
        <span
          className="min-w-0 flex-1 truncate"
          style={{
            fontFamily: 'var(--font-soehne)',
            fontSize: '13px',
            lineHeight: 1.35
          }}
        >
          {entry.name}
        </span>
      </button>
      {open ? (
        <FolderBody
          path={path}
          depth={depth}
          api={api}
          onContextMenu={onContextMenu}
        />
      ) : null}
    </>
  )
}

function RowStub({
  depth,
  label,
  tone
}: {
  depth: number
  label: string
  tone: 'dirty' | 'bad'
}): React.JSX.Element {
  const indent = ROW_PAD_LEFT + depth * INDENT_PER_LEVEL
  return (
    <div
      className="truncate py-[3px] pr-2 italic"
      style={{
        paddingLeft: `${indent}px`,
        fontSize: '12px',
        fontFamily: 'var(--font-soehne)',
        color: tone === 'bad' ? 'var(--orange)' : 'var(--dirty-grey)'
      }}
    >
      {label}
    </div>
  )
}

/* ─── Menu entries ───────────────────────────────────────────────────── */

function buildEntries(target: MenuTarget, api: FileTreeApi): ContextMenuEntry[] {
  const { path, isDir, refreshPath } = target

  const newFile = (): void => {
    const folder = isDir ? path : parentOf(path)
    const name = window.prompt('Name of new file', '')
    if (!name) return
    void window.mucka
      .createFile(folder, name)
      .then(() => {
        if (isDir && !api.open.has(path)) api.toggle(path)
        api.reload(folder)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        window.alert(`Couldn't create file: ${message}`)
      })
  }

  const newFolder = (): void => {
    const folder = isDir ? path : parentOf(path)
    const name = window.prompt('Name of new folder', '')
    if (!name) return
    void window.mucka
      .createFolder(folder, name)
      .then(() => {
        if (isDir && !api.open.has(path)) api.toggle(path)
        api.reload(folder)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        window.alert(`Couldn't create folder: ${message}`)
      })
  }

  const reveal = (): void => {
    void window.mucka.revealInOs(path)
  }

  const openWithDefault = (): void => {
    void window.mucka.openPathInOs(path)
  }

  const copyPath = (): void => {
    void navigator.clipboard.writeText(path)
  }

  const copyRelativePath = (): void => {
    void navigator.clipboard.writeText(relativeTo(path, api.root))
  }

  const renameThis = (): void => {
    const current = basename(path)
    const next = window.prompt('Rename to', current)
    if (!next || next === current) return
    void window.mucka
      .renamePath(path, next)
      .then(() => api.reload(refreshPath))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        window.alert(`Couldn't rename: ${message}`)
      })
  }

  const deleteThis = (): void => {
    const label = basename(path)
    const ok = window.confirm(
      isDir
        ? `Delete folder "${label}" and everything inside it?\n\nThis can't be undone.`
        : `Delete file "${label}"?\n\nThis can't be undone.`
    )
    if (!ok) return
    void window.mucka
      .deletePath(path)
      .then(() => api.reload(refreshPath))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        window.alert(`Couldn't delete: ${message}`)
      })
  }

  const isRoot = path === api.root
  const entries: ContextMenuEntry[] = [
    { id: 'new-file', label: 'New File…', onClick: newFile },
    { id: 'new-folder', label: 'New Folder…', onClick: newFolder },
    { id: 'sep-1', kind: 'separator' },
    { id: 'reveal', label: 'Reveal in Finder', shortcut: '⌥⌘R', onClick: reveal }
  ]
  if (!isDir) {
    entries.push({
      id: 'open',
      label: 'Open with default app',
      onClick: openWithDefault
    })
  }
  entries.push(
    { id: 'sep-2', kind: 'separator' },
    { id: 'copy-path', label: 'Copy Path', shortcut: '⌥⌘C', onClick: copyPath },
    {
      id: 'copy-rel',
      label: 'Copy Relative Path',
      shortcut: '⌥⇧⌘C',
      onClick: copyRelativePath
    }
  )
  if (!isRoot) {
    entries.push(
      { id: 'sep-3', kind: 'separator' },
      { id: 'rename', label: 'Rename…', shortcut: '↵', onClick: renameThis },
      {
        id: 'delete',
        label: 'Delete',
        shortcut: '⌘⌫',
        onClick: deleteThis,
        danger: true
      }
    )
  }
  return entries
}
