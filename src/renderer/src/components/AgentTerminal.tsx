import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentId, TerminalId } from '@shared/types'

interface AgentTerminalProps {
  terminalId: TerminalId
  agentId: AgentId
  /**
   * Whether this terminal is the currently-visible tab. Inactive terminals
   * stay mounted (so their PTYs don't tear down on switch) but skip the
   * resize observer's `fit.fit()` calls — xterm's measurement is wrong when
   * the host is `display: none`.
   */
  isActive?: boolean
  /**
   * Optional sniffer for the PTY data stream. Receives raw chunks before
   * xterm interprets them — used for URL auto-detection on the
   * preview-source tab.
   */
  onData?: (data: string) => void
  /**
   * If set, this string + Enter is typed into the PTY shortly after spawn.
   * Used by the "preview" button to auto-run a dev-server command. Runs
   * only once per mount — changing the prop after mount has no effect.
   */
  autoCommand?: string
}

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

function separator(): string {
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const label = `── reconnected · ${time} ──`
  return `\r\n\x1b[38;5;208m${label}\x1b[0m\r\n`
}

export function AgentTerminal({
  terminalId,
  agentId,
  isActive = true,
  onData,
  autoCommand
}: AgentTerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onDataRef = useRef(onData)
  // Captured at mount — autoCommand is intentionally one-shot.
  const autoCommandRef = useRef(autoCommand)
  // Last (cols, rows) sent to the PTY — used to suppress redundant
  // SIGWINCH on sub-pixel reflows. Without this, every Vercel/Git poll
  // update, font load or attention-glow keyframe tick fires the
  // ResizeObserver and zsh redraws its prompt, spamming the terminal
  // with empty `$ ` lines.
  const lastPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)

  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false

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

    // VSCode-style Shift+Enter — send ESC+CR (the iTerm2 convention) so
    // Claude Code's TUI treats it as a multi-line continuation instead
    // of submitting the prompt. Plain Enter still sends \r.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (
        event.type === 'keydown' &&
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        window.mucka.writePty({ terminalId, data: '\x1b\r' })
        return false
      }
      return true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    try {
      fit.fit()
    } catch {
      /* host not laid out yet */
    }

    const focusTerm = (): void => term.focus()
    host.addEventListener('mousedown', focusTerm)

    const offData = window.mucka.onPtyData((event) => {
      if (event.terminalId !== terminalId) return
      term.write(event.data)
      onDataRef.current?.(event.data)
    })

    const offExit = window.mucka.onPtyExit((event) => {
      if (event.terminalId !== terminalId) return
      term.write(
        `\r\n\x1b[38;5;208m[mucka] shell exited (code ${event.exitCode})\x1b[0m\r\n`
      )
    })

    const onUserInput = term.onData((data) => {
      window.mucka.writePty({ terminalId, data })
    })

    const resizeObserver = new ResizeObserver(() => {
      // Skip fitting when hidden — xterm needs visible dimensions to measure.
      if (host.offsetParent === null) return
      try {
        fit.fit()
        const cols = term.cols
        const rows = term.rows
        const prev = lastPtySizeRef.current
        // Only send SIGWINCH when dimensions actually changed. Layout
        // jitter from sibling panels (Vercel poll, Git poll, scrollbar
        // appear/disappear, font swap) would otherwise spam the shell
        // with redundant resize signals and force a prompt redraw each
        // time.
        if (prev && prev.cols === cols && prev.rows === rows) return
        lastPtySizeRef.current = { cols, rows }
        window.mucka.resizePty({ terminalId, cols, rows })
      } catch {
        /* nothing to fit */
      }
    })
    resizeObserver.observe(host)

    ;(async () => {
      const prior = await window.mucka.getScrollback(terminalId)
      if (cancelled) return
      if (prior.length > 0) {
        term.write(prior)
        term.write(separator())
      }
      await window.mucka.spawnPty({
        terminalId,
        agentId,
        cols: term.cols,
        rows: term.rows
      })
      // Give the shell a beat to print its prompt before injecting input.
      // Without the delay, `npm run dev` lands before zsh's rc files finish
      // sourcing and you see it land in front of the prompt cosmetically.
      const cmd = autoCommandRef.current
      if (cmd) {
        setTimeout(() => {
          if (cancelled) return
          window.mucka.writePty({ terminalId, data: cmd + '\r' })
        }, 250)
      }
    })().catch(() => {
      /* spawn errors surface as visible failures in the terminal */
    })

    return () => {
      cancelled = true
      host.removeEventListener('mousedown', focusTerm)
      resizeObserver.disconnect()
      onUserInput.dispose()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId, agentId])

  // When a hidden tab becomes active again, re-fit so xterm matches the
  // now-visible host dimensions (ResizeObserver doesn't fire for visibility
  // changes alone).
  useEffect(() => {
    if (!isActive) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    const handle = window.requestAnimationFrame(() => {
      try {
        fit.fit()
        const cols = term.cols
        const rows = term.rows
        const prev = lastPtySizeRef.current
        if (!prev || prev.cols !== cols || prev.rows !== rows) {
          lastPtySizeRef.current = { cols, rows }
          window.mucka.resizePty({ terminalId, cols, rows })
        }
        term.focus()
      } catch {
        /* mid-teardown */
      }
    })
    return () => window.cancelAnimationFrame(handle)
  }, [isActive, terminalId])

  return <div ref={hostRef} className="size-full bg-[#1a1612]" />
}
