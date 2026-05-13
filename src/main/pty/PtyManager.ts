import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebContents } from 'electron'
import type {
  AgentId,
  PtyDataEvent,
  PtyExitEvent,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest
} from '@shared/types'
import { getAgentConfig } from '../config/agents'

interface AgentPty {
  agentId: AgentId
  proc: IPty
}

/**
 * Owns the live PTY processes (one per agent). Fans output to the renderer
 * via webContents.send. Spawn is idempotent — calling it again after exit
 * starts a fresh process at the agent's current cwd.
 */
export class PtyManager {
  private readonly ptys = new Map<AgentId, AgentPty>()
  private readonly webContents: WebContents

  constructor(webContents: WebContents) {
    this.webContents = webContents
  }

  spawn(req: PtySpawnRequest): void {
    const existing = this.ptys.get(req.agentId)
    if (existing) {
      try {
        existing.proc.kill()
      } catch {
        /* already dead */
      }
      this.ptys.delete(req.agentId)
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
        MUCKA_AGENT: cfg.id
      }
    })

    proc.onData((data) => {
      if (this.webContents.isDestroyed()) return
      const event: PtyDataEvent = { agentId: req.agentId, data }
      this.webContents.send('pty:data', event)
    })

    proc.onExit(({ exitCode, signal }) => {
      this.ptys.delete(req.agentId)
      if (this.webContents.isDestroyed()) return
      const event: PtyExitEvent = {
        agentId: req.agentId,
        exitCode,
        signal: signal ?? null
      }
      this.webContents.send('pty:exit', event)
    })

    this.ptys.set(req.agentId, { agentId: req.agentId, proc })
  }

  write({ agentId, data }: PtyWriteRequest): void {
    const entry = this.ptys.get(agentId)
    if (!entry) return
    entry.proc.write(data)
  }

  resize({ agentId, cols, rows }: PtyResizeRequest): void {
    const entry = this.ptys.get(agentId)
    if (!entry) return
    try {
      entry.proc.resize(Math.max(20, cols), Math.max(5, rows))
    } catch {
      /* pty may have just exited */
    }
  }

  kill(agentId: AgentId): void {
    const entry = this.ptys.get(agentId)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* already dead */
    }
    this.ptys.delete(agentId)
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) {
      this.kill(id)
    }
  }
}
