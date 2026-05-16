import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lightweight right-click menu — portaled to <body> so it can escape
 * any clip-path / overflow:hidden parent. Closes on outside click,
 * Escape, or item activation.
 */

export interface ContextMenuItem {
  id: string
  label: string
  /** Optional keyboard hint shown at the right of the row. */
  shortcut?: string
  onClick: () => void
  /** Renders in orange — destructive / red-team actions. */
  danger?: boolean
  disabled?: boolean
}

export interface ContextMenuSeparator {
  id: string
  kind: 'separator'
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ContextMenuProps {
  x: number
  y: number
  entries: ContextMenuEntry[]
  onClose: () => void
}

const MENU_WIDTH = 230

function isSeparator(e: ContextMenuEntry): e is ContextMenuSeparator {
  return 'kind' in e && e.kind === 'separator'
}

export function ContextMenu({
  x,
  y,
  entries,
  onClose
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (!menuRef.current) return
      if (e.target instanceof Node && menuRef.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp position so the menu stays on-screen.
  const clampedX = Math.min(
    x,
    Math.max(0, window.innerWidth - MENU_WIDTH - 8)
  )
  const clampedY = Math.min(
    y,
    Math.max(0, window.innerHeight - entries.length * 28 - 24)
  )

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: clampedY,
        left: clampedX,
        width: `${MENU_WIDTH}px`,
        zIndex: 200,
        background: 'var(--charcoal)',
        color: 'var(--van-white)',
        borderRadius: 6,
        padding: 4,
        boxShadow:
          '0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35)',
        fontFamily: 'var(--font-soehne)',
        fontSize: '12.5px',
        border: '1px solid rgba(234, 233, 232, 0.08)'
      }}
    >
      {entries.map((entry) => {
        if (isSeparator(entry)) {
          return (
            <div
              key={entry.id}
              style={{
                height: 1,
                margin: '4px 6px',
                background: 'rgba(234, 233, 232, 0.08)'
              }}
            />
          )
        }
        const { id, label, shortcut, onClick, danger, disabled } = entry
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              onClick()
              onClose()
            }}
            className="group flex w-full items-center justify-between rounded-sm px-2 py-[5px] text-left transition-colors hover:enabled:bg-van-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: danger ? 'var(--orange)' : undefined
            }}
          >
            <span>{label}</span>
            {shortcut ? (
              <span
                className="font-mono text-[0.65rem]"
                style={{ color: 'rgba(234, 233, 232, 0.55)' }}
              >
                {shortcut}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
