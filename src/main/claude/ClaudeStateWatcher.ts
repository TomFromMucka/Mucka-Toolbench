import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig, AgentId, AgentStatus, AgentStatusEvent } from '@shared/types'

/**
 * Reads what Claude Code reports about itself.
 *
 * The cockpit used to infer status by pattern-matching the PTY stream,
 * which cannot work: the TUI redraws in place, so the stream holds
 * interleaved fragments and cues like "esc to interrupt" never appear
 * contiguously (verified against real scrollback — zero matches across
 * four agents). Claude Code now tells us instead, via
 * `~/.claude/mucka-agent-state.sh` wired into the statusline (model +
 * context window) and the UserPromptSubmit / Notification / Stop hooks
 * (activity). Each worktree gets one small JSON file here.
 */

const DEFAULT_STATE_DIR = join(homedir(), '.claude', 'mucka-state')

/**
 * How long a "working" claim stays believable without a refresh. The
 * statusline rewrites the file on every TUI render, so a live turn keeps
 * this fresh; a Claude killed mid-turn never sends Stop, and without this
 * its agent would read as busy forever.
 */
const STALE_MS = 90_000
const SWEEP_MS = 15_000

interface ClaudeState {
  cwd: string
  /** Agent id from $MUCKA_AGENT, when the cockpit itself launched it. */
  agent: string | null
  model: string | null
  ctxUsed: number | null
  activity: string
  ts: number
}

const ACTIVITY_STATUS: Record<string, AgentStatus> = {
  working: 'thinking',
  waiting: 'awaiting-input',
  idle: 'idle'
}

function parseState(raw: string): ClaudeState | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const o = v as Record<string, unknown>
    if (typeof o.cwd !== 'string' || o.cwd.length === 0) return null
    return {
      cwd: o.cwd,
      agent: typeof o.agent === 'string' && o.agent.length > 0 ? o.agent : null,
      model: typeof o.model === 'string' ? o.model : null,
      ctxUsed: typeof o.ctxUsed === 'number' ? o.ctxUsed : null,
      activity: typeof o.activity === 'string' ? o.activity : 'idle',
      ts: typeof o.ts === 'number' ? o.ts : 0
    }
  } catch {
    return null
  }
}

/**
 * Claude's cwd can be a subdirectory of the worktree it was started in, so
 * match on the longest worktree path that prefixes it.
 *
 * An agent still pointed at the home directory (a fresh, unconfigured one)
 * is skipped: it prefixes every path on the machine, so it would claim
 * every unrelated Claude session Tom happens to run.
 */
export function agentForCwd(cwd: string, agents: AgentConfig[]): AgentId | null {
  const home = homedir().replace(/\/+$/, '')
  let best: { id: AgentId; length: number } | null = null
  for (const cfg of agents) {
    const root = cfg.worktreePath.replace(/\/+$/, '')
    if (root.length === 0 || root === home) continue
    if (cwd !== root && !cwd.startsWith(`${root}/`)) continue
    if (!best || root.length > best.length) best = { id: cfg.id, length: root.length }
  }
  return best?.id ?? null
}

export class ClaudeStateWatcher {
  private readonly emit: (event: AgentStatusEvent) => void
  private readonly listAgents: () => AgentConfig[]
  private readonly stateDir: string
  private watcher: FSWatcher | null = null
  private sweep: NodeJS.Timeout | null = null
  private readonly last = new Map<AgentId, string>()

  constructor(
    emit: (event: AgentStatusEvent) => void,
    listAgents: () => AgentConfig[],
    stateDir: string = DEFAULT_STATE_DIR
  ) {
    this.emit = emit
    this.listAgents = listAgents
    this.stateDir = stateDir
  }

  start(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true })
    } catch {
      /* unwritable home — watcher just stays quiet */
    }
    if (!existsSync(this.stateDir)) return
    try {
      this.watcher = watch(this.stateDir, () => this.refresh())
    } catch {
      this.watcher = null
    }
    // fs.watch misses some editors/atomic renames on macOS, and staleness
    // has to be re-evaluated on a clock anyway.
    this.sweep = setInterval(() => this.refresh(), SWEEP_MS)
    this.refresh()
  }

  refresh(): void {
    let files: string[]
    try {
      files = readdirSync(this.stateDir).filter((f) => f.endsWith('.json'))
    } catch {
      return
    }

    const now = Date.now()
    const agents = this.listAgents()

    // One agent can own several state files — Claude started at the
    // worktree root writes a different file than Claude started in a
    // subdirectory of it. Keep the freshest, or a long-abandoned session
    // could mask the live one.
    const freshest = new Map<AgentId, ClaudeState>()

    for (const file of files) {
      let state: ClaudeState | null = null
      try {
        state = parseState(readFileSync(join(this.stateDir, file), 'utf8'))
      } catch {
        state = null
      }
      if (!state) continue

      // $MUCKA_AGENT is an exact binding from the cockpit's own PTY env;
      // fall back to matching the path only when it's absent.
      const claimed = agents.find((a) => a.id === state.agent)?.id ?? null
      const agentId = claimed ?? agentForCwd(state.cwd, agents)
      if (!agentId) continue
      const held = freshest.get(agentId)
      if (!held || state.ts > held.ts) freshest.set(agentId, state)
    }

    for (const [agentId, state] of freshest) {
      const stale = now - state.ts > STALE_MS
      const status: AgentStatus =
        stale && state.activity === 'working'
          ? 'idle'
          : (ACTIVITY_STATUS[state.activity] ?? 'idle')

      this.push({
        agentId,
        status,
        contextUsedPercent: state.ctxUsed,
        model: state.model
      })
    }
  }

  /** Drop an agent back to idle — used when its shells are torn down. */
  clear(agentId: AgentId): void {
    this.push({ agentId, status: 'idle', contextUsedPercent: null, model: null })
  }

  private push(event: AgentStatusEvent): void {
    const key = `${event.status}|${event.contextUsedPercent ?? ''}|${event.model ?? ''}`
    if (this.last.get(event.agentId) === key) return
    this.last.set(event.agentId, key)
    this.emit(event)
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
    this.last.clear()
  }
}
