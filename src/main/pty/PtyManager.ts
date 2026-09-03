import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebContents } from 'electron'
import type {
  AgentConfig,
  AgentId,
  PtyDataEvent,
  PtyExitEvent,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest,
  TerminalId
} from '@shared/types'
import { SECRET_DEFS } from '@shared/secrets'
import { getAgentConfig } from '../config/agents'
import { scrollback } from '../scrollback/Scrollback'

/**
 * Env names that must never reach a worker shell. The cockpit decrypts
 * its integration tokens into `process.env` at boot; a worker Claude has
 * Bash, so anything inherited is one `env` away from its scrollback (and
 * from Mucka's `get_recent_output`).
 */
const WITHHELD_ENV = new Set<string>([
  ...SECRET_DEFS.map((d) => d.envName),
  'GH_TOKEN'
])

function agentShellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!WITHHELD_ENV.has(key)) env[key] = value
  }
  return env
}

interface TerminalPty {
  terminalId: TerminalId
  agentId: AgentId
  proc: IPty
  /** What this proc was actually spawned with — see `spawn`. */
  signature: string
}

/** Identifies the shell a spawn request is asking for. */
function signatureFor(cfg: AgentConfig): string {
  return JSON.stringify([cfg.command, cfg.args, cfg.worktreePath])
}

/**
 * Owns the live PTY processes — keyed by terminalId, not agentId, so a
 * single agent can host multiple sub-terminals.
 *
 * Spawn is attach-or-create: a repeat call for a terminal already running
 * the requested shell reattaches to it, and only a request for a
 * *different* shell (the agent's command, args or cwd changed) tears the
 * old proc down. Restarting is therefore an explicit act — `killByAgent`
 * via the `agents:restart` IPC — not a side effect of the renderer
 * remounting a clipboard.
 */
export class PtyManager {
  private readonly ptys = new Map<TerminalId, TerminalPty>()
  private readonly webContents: WebContents

  constructor(webContents: WebContents) {
    this.webContents = webContents
  }

  spawn(req: PtySpawnRequest): void {
    const cfg = getAgentConfig(req.agentId)
    if (!cfg) throw new Error(`Unknown agent: ${req.agentId}`)

    const signature = signatureFor(cfg)
    const existing = this.ptys.get(req.terminalId)
    if (existing) {
      // The renderer remounts a terminal for purely visual reasons — a
      // layout change, a tab reshuffle, dev-server HMR — and each mount
      // asks to spawn. When the live shell is already the one being asked
      // for, reattach: killing it here would drop a running Claude session
      // on the floor. The renderer has replayed scrollback by this point,
      // so all that's left is to match the new pane size.
      if (existing.signature === signature) {
        this.resize({ terminalId: req.terminalId, cols: req.cols, rows: req.rows })
        return
      }
      try {
        existing.proc.kill()
      } catch {
        /* already dead */
      }
    }

    const proc = pty.spawn(cfg.command, cfg.args, {
      name: 'xterm-256color',
      cols: Math.max(20, req.cols),
      rows: Math.max(5, req.rows),
      cwd: cfg.worktreePath,
      env: {
        ...agentShellEnv(),
        TERM: 'xterm-256color',
        MUCKA_AGENT: cfg.id,
        MUCKA_TERMINAL: req.terminalId
      }
    })

    const entry: TerminalPty = {
      terminalId: req.terminalId,
      agentId: req.agentId,
      proc,
      signature
    }

    proc.onData((data) => {
      if (this.ptys.get(req.terminalId)?.proc !== proc) return
      scrollback.append(req.terminalId, data)
      if (this.webContents.isDestroyed()) return
      const event: PtyDataEvent = { terminalId: req.terminalId, data }
      this.webContents.send('pty:data', event)
    })

    proc.onExit(({ exitCode, signal }) => {
      const current = this.ptys.get(req.terminalId)
      const isCurrent = current?.proc === proc
      if (isCurrent) {
        this.ptys.delete(req.terminalId)
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
  }
}
