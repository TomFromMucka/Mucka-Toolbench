import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentId } from '@shared/types'

interface AgentTerminalProps {
  agentId: AgentId
}

/** Brand-tinted xterm theme — sits inside a cream Clipboard like an embedded screen. */
const THEME = {
  background: '#1a1612',
  foreground: '#f5f0e6',
  cursor: '#ff7b3a',
  cursorAccent: '#1a1612',
  selectionBackground: '#ff4e0044',
  black: '#2a2520',
  red: '#a13a2a',
  green: '#7a9a5a',
  yellow: '#c08a30',
  blue: '#6a8aa5',
  magenta: '#a76090',
  cyan: '#5fa5a0',
  white: '#e6dfd0',
  brightBlack: '#5a4f42',
  brightRed: '#c64a3a',
  brightGreen: '#9abf6a',
  brightYellow: '#e0a040',
  brightBlue: '#85a8c8',
  brightMagenta: '#c878b0',
  brightCyan: '#7fc8c2',
  brightWhite: '#f5f0e6'
} as const

export function AgentTerminal({ agentId }: AgentTerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Fira Code", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      allowProposedApi: true,
      theme: THEME
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    // Initial fit before spawn so the PTY starts at the right size.
    try {
      fit.fit()
    } catch {
      /* host not laid out yet */
    }
    const initialCols = term.cols
    const initialRows = term.rows

    void window.mucka.spawnPty({
      agentId,
      cols: initialCols,
      rows: initialRows
    })

    const offData = window.mucka.onPtyData((event) => {
      if (event.agentId !== agentId) return
      term.write(event.data)
    })

    const offExit = window.mucka.onPtyExit((event) => {
      if (event.agentId !== agentId) return
      term.write(
        `\r\n\x1b[38;5;208m[mucka] shell exited (code ${event.exitCode})\x1b[0m\r\n`
      )
    })

    const onUserInput = term.onData((data) => {
      window.mucka.writePty({ agentId, data })
    })

    // Re-fit on container resize.
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
        window.mucka.resizePty({
          agentId,
          cols: term.cols,
          rows: term.rows
        })
      } catch {
        /* nothing to fit */
      }
    })
    resizeObserver.observe(host)

    return () => {
      resizeObserver.disconnect()
      onUserInput.dispose()
      offData()
      offExit()
      term.dispose()
      // PTY lives on in main; main owns its lifecycle (kills on quit).
    }
  }, [agentId])

  return (
    <div
      ref={hostRef}
      className="size-full bg-[#1a1612]"
      // xterm.js manages this element — keep React out of its hair.
    />
  )
}
