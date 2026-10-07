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
import { jobShell } from '../jobs/JobManager'
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
  /** Null for a job's terminal. */
  agentId: AgentId | null
  proc: IPty
  /** What this proc was actually spawned with — see `spawn`. */
  signature: string
}

/** Identifies the shell a spawn request is asking for. */
interface ShellSpec {
  command: string
  args: string[]
  cwd: string
  /** Tells the hooks which agent or job this Claude belongs to. */
  owner: { MUCKA_AGENT: string } | { MUCKA_JOB: string }
  env?: Record<string, string>
}

function signatureFor(spec: ShellSpec): string {
  return JSON.stringify([spec.command, spec.args, spec.cwd])
}

function specFor(req: PtySpawnRequest): ShellSpec {
  if (req.jobId !== undefined) {
    const shell = jobShell(req.jobId)
    if (!shell) throw new Error(`Job ${req.jobId} isn't ready for a terminal yet`)
    return { ...shell, owner: { MUCKA_JOB: req.jobId } }
  }
  const cfg: AgentConfig | undefined = getAgentConfig(req.agentId)
  if (!cfg) throw new Error(`Unknown agent: ${req.agentId}`)
  return {
    command: cfg.command,
    args: cfg.args,
    cwd: cfg.worktreePath,
    owner: { MUCKA_AGENT: cfg.id }
  }
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
    // A job's terminal only ever runs one shell, so a live one is always
    // the right one. Its command does change over the job's life (`claude`
    // becomes `claude --continue` once there's history, and a finished
    // job has no folder left to ask for), and comparing it would kill a
    // working Claude whenever the layout remounted its terminal.
    if (req.jobId !== undefined && this.ptys.has(req.terminalId)) {
      this.resize({ terminalId: req.terminalId, cols: req.cols, rows: req.rows })
      return
    }
    const spec = specFor(req)
    const signature = signatureFor(spec)
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
      this.kill(req.terminalId)
    }

    const proc = pty.spawn(spec.command, spec.args, {
      name: 'xterm-256color',
      cols: Math.max(20, req.cols),
      rows: Math.max(5, req.rows),
      cwd: spec.cwd,
      env: {
        ...agentShellEnv(),
        TERM: 'xterm-256color',
        ...spec.owner,
        ...spec.env,
        MUCKA_TERMINAL: req.terminalId
      }
    })

    const entry: TerminalPty = {
      terminalId: req.terminalId,
      agentId: req.agentId ?? null,
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

  /**
   * Kill one terminal and forget its scrollback. The buffer belongs to the
   * process that produced it: left in place, a fresh shell would replay a
   * dead session's prompt above its own, and anything polling the buffer
   * for signs of life would be reading the corpse.
   */
  kill(terminalId: TerminalId): void {
    const entry = this.ptys.get(terminalId)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* already dead */
    }
    this.ptys.delete(terminalId)
    scrollback.clear(terminalId)
  }

  /** Kill without forgetting scrollback — for quit, where the buffer is about to be persisted. */
  private release(terminalId: TerminalId): void {
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
      this.release(id)
    }
  }
}
