import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebContents } from 'electron'
import type {
  AgentId,
  AgentStatusEvent,
  PtyDataEvent,
  PtyExitEvent,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest,
  TerminalId
} from '@shared/types'
import { getAgentConfig } from '../config/agents'
import { scrollback } from '../scrollback/Scrollback'
import { StatusDetector } from './StatusDetector'

interface TerminalPty {
  terminalId: TerminalId
  agentId: AgentId
  proc: IPty
}

/**
 * Owns the live PTY processes — keyed by terminalId, not agentId, so a
 * single agent can host multiple sub-terminals. Spawn is idempotent: a
 * repeat call for the same terminalId tears down the previous proc and
 * starts a fresh one at the owning agent's current cwd.
 */
export class PtyManager {
  private readonly ptys = new Map<TerminalId, TerminalPty>()
  private readonly webContents: WebContents
  private readonly statusDetector: StatusDetector

  constructor(webContents: WebContents) {
    this.webContents = webContents
    this.statusDetector = new StatusDetector((emit) => {
      if (this.webContents.isDestroyed()) return
      const event: AgentStatusEvent = {
        agentId: emit.agentId,
        status: emit.status,
        contextPercent: emit.contextPercent
      }
      this.webContents.send('agent:status', event)
    })
  }

  spawn(req: PtySpawnRequest): void {
    const existing = this.ptys.get(req.terminalId)
    if (existing) {
      try {
        existing.proc.kill()
      } catch {
        /* already dead */
      }
    }

    const cfg = getAgentConfig(req.agentId)
    if (!cfg) throw new Error(`Unknown agent: ${req.agentId}`)

    const proc = pty.spawn(cfg.command, cfg.args, {
      name: 'xterm-256color',
      cols: Math.max(20, req.cols),
      rows: Math.max(5, req.rows),
      cwd: cfg.worktreePath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        MUCKA_AGENT: cfg.id,
        MUCKA_TERMINAL: req.terminalId
      }
    })

    const entry: TerminalPty = {
      terminalId: req.terminalId,
      agentId: req.agentId,
      proc
    }

    this.statusDetector.register(req.terminalId, req.agentId)

    proc.onData((data) => {
      if (this.ptys.get(req.terminalId)?.proc !== proc) return
      scrollback.append(req.terminalId, data)
      this.statusDetector.ingest(req.terminalId, data)
      if (this.webContents.isDestroyed()) return
      const event: PtyDataEvent = { terminalId: req.terminalId, data }
      this.webContents.send('pty:data', event)
    })

    proc.onExit(({ exitCode, signal }) => {
      const current = this.ptys.get(req.terminalId)
      const isCurrent = current?.proc === proc
      if (isCurrent) {
        this.ptys.delete(req.terminalId)
        this.statusDetector.release(req.terminalId)
      }
      if (this.webContents.isDestroyed() || !isCurrent) return
      const event: PtyExitEvent = {
        terminalId: req.terminalId,
        exitCode,
        signal: signal ?? null
      }
      this.webContents.send('pty:exit', event)
    })

    this.ptys.set(req.terminalId, entry)
  }

  write({ terminalId, data }: PtyWriteRequest): void {
    const entry = this.ptys.get(terminalId)
    if (!entry) return
    entry.proc.write(data)
  }

  resize({ terminalId, cols, rows }: PtyResizeRequest): void {
    const entry = this.ptys.get(terminalId)
    if (!entry) return
    try {
      entry.proc.resize(Math.max(20, cols), Math.max(5, rows))
    } catch {
      /* pty may have just exited */
    }
  }

  kill(terminalId: TerminalId): void {
    const entry = this.ptys.get(terminalId)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* already dead */
    }
    this.ptys.delete(terminalId)
    this.statusDetector.release(terminalId)
  }

  /**
   * Kill every PTY owned by an agent — its primary terminal + every
   * split / preview sub-terminal. Used when Tom (or Mucka) stops the
   * agent from the cockpit UI.
   */
  /** Whether a terminal is currently live (PTY spawned). */
  hasTerminal(terminalId: TerminalId): boolean {
    return this.ptys.has(terminalId)
  }

  killByAgent(agentId: AgentId): void {
    const targets = [...this.ptys.values()].filter((e) => e.agentId === agentId)
    for (const entry of targets) {
      this.kill(entry.terminalId)
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) {
      this.kill(id)
    }
    this.statusDetector.disposeAll()
  }
}
