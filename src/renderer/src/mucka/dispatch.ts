import type { AgentId } from '@shared/types'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Heuristics that Claude Code's TUI is up and waiting for input.
const CLAUDE_READY = /│\s*>|\? for shortcuts|esc to interrupt|Welcome to Claude|Try ["“]/i

/**
 * Poll an agent's scrollback until Claude Code looks ready for a prompt:
 * either a known TUI marker shows up, or output goes quiet for a beat.
 * Bounded by a timeout so a dispatch never hangs forever.
 */
export async function waitForClaudeReady(
  terminalId: string,
  timeoutMs = 20000
): Promise<void> {
  await delay(1500) // let the PTY spawn + Claude start booting
  const start = Date.now()
  let lastLen = -1
  let stable = 0
  while (Date.now() - start < timeoutMs) {
    let sb = ''
    try {
      sb = await window.mucka.getScrollback(terminalId)
    } catch {
      sb = ''
    }
    if (CLAUDE_READY.test(sb)) return
    if (sb.length > 0 && sb.length === lastLen) {
      stable += 1
      if (stable >= 3) return // ~2s of quiet — assume the prompt is ready
    } else {
      stable = 0
      lastLen = sb.length
    }
    await delay(700)
  }
}

/**
 * Type a prompt into a terminal without submitting it.
 *
 * Multi-line text goes in wrapped in bracketed-paste markers: a raw write
 * would be read as one Enter per newline, submitting the first line and
 * scattering the rest. Inside the markers the receiving TUI takes the whole
 * block as a single paste, so a markdown ticket body survives intact.
 * Single-line text is written plainly — the target may be a bare shell
 * rather than Claude, and there's nothing to protect.
 */
export function submitPrompt(terminalId: string, prompt: string): void {
  const body = prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const data = body.includes('\n') ? `\x1b[200~${body}\x1b[201~` : body
  window.mucka.writePty({ terminalId, data })
}

/** Press Enter after a paste has had a beat to land in the TUI's input. */
export async function submitPromptAndEnter(
  terminalId: string,
  prompt: string
): Promise<void> {
  submitPrompt(terminalId, prompt)
  await delay(150)
  window.mucka.writePty({ terminalId, data: '\r' })
}

export interface LaunchClaudeOptions {
  agentId: AgentId
  /** The first prompt Claude receives once its TUI is up. */
  prompt: string
  /** Optional cwd change — omit to launch in the agent's current worktree. */
  worktreePath?: string
  /** Pull fresh agent configs after the restart so the UI matches the DB. */
  reloadAgents: () => Promise<void>
  /** Force the clipboard to remount so the new shell is the one on screen. */
  bumpRestart: (agent: AgentId) => void
}

/**
 * Point an agent at Claude Code, restart it so the session is fresh, and
 * submit `prompt` as its opening task.
 *
 * The restart is deliberate: `spawnPty` reattaches to a matching live shell,
 * so without it a prompt aimed at a stopped-then-started agent could land
 * mid-way through whatever session was already running there.
 */
export async function launchClaudeWithPrompt({
  agentId,
  prompt,
  worktreePath,
  reloadAgents,
  bumpRestart
}: LaunchClaudeOptions): Promise<void> {
  await window.mucka.updateAgent({
    id: agentId,
    command: 'claude',
    args: [],
    ...(worktreePath ? { worktreePath } : {})
  })
  await window.mucka.restartAgent(agentId)
  await reloadAgents()
  bumpRestart(agentId)
  await waitForClaudeReady(agentId)
  await submitPromptAndEnter(agentId, prompt)
}
