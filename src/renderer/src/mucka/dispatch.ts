import type { AgentId } from '@shared/types'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait for a freshly launched Claude to report ready. The signal comes from
 * Claude Code itself (its statusline hook writes the cockpit's state file
 * on first render) — never from the PTY stream, which redraws in place and
 * can't be read for cues. Falls through after the timeout so a machine
 * without the hook still gets its prompt, just later than it needs to.
 */
export async function waitForClaudeReady(agentId: AgentId, timeoutMs = 20000): Promise<void> {
  const ready = await window.mucka.awaitClaudeReady(agentId, timeoutMs)
  // The first render lands a beat before the input accepts a paste.
  await delay(ready ? 750 : 2000)
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
