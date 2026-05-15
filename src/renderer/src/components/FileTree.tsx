import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FsEntry } from '@shared/types'
import { Icon } from './ui/Icon'
import { joinPath, type FileTreeApi } from '../hooks/useFileTree'

interface FileTreeProps {
  api: FileTreeApi
}

const ROW_PAD_LEFT = 8
const INDENT_PER_LEVEL = 12

export function FileTree({ api }: FileTreeProps): React.JSX.Element {
  if (!api.root) {
    return (
      <p className="px-3 py-3 t-body-md" style={{ color: 'var(--dirty-grey)' }}>
        Select a worktree to browse files.
      </p>
    )
  }
  return <FolderBody path={api.root} depth={0} api={api} />
}

function FolderBody({
  path,
  depth,
  api
}: {
  path: string
  depth: number
  api: FileTreeApi
}): React.JSX.Element | null {
  const state = api.nodes.get(path)
  if (!state) return null
  if (state.kind === 'loading') {
    return (
      <RowStub depth={depth + 1} label="Loading…" tone="dirty" />
    )
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
        />
      ))}
    </>
  )
}

function TreeRow({
  parent,
  entry,
  depth,
  api
}: {
  parent: string
  entry: FsEntry
  depth: number
  api: FileTreeApi
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
      {open ? <FolderBody path={path} depth={depth} api={api} /> : null}
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
