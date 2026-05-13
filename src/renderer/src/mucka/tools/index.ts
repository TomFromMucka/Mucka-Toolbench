import type { ClientTools } from '@elevenlabs/react'
import type {
  AgentConfig,
  AgentId,
  GitStatus,
  NoticeColour
} from '@shared/types'
import { MUCKA_AGENT_IDS } from '@shared/mucka-tools'
import type { ConfirmRequest } from '../MuckaSessionContext'

interface ToolDeps {
  setAmbientStatus: (text: string | null) => void
  bumpRestart: (agent: AgentId) => void
  requestConfirm: (req: ConfirmRequest) => Promise<boolean>
  /** Pull a fresh agents list from the DB (after a write tool changes one). */
  reloadAgents: () => Promise<void>
  /** Pull a fresh notice list from the DB (after add/remove). */
  reloadNotices: () => Promise<void>
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function lastLines(s: string, n: number): string {
  const lines = stripAnsi(s).split(/\r?\n/)
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-n).join('\n')
}

function parseAgentId(params: Record<string, unknown>): AgentId {
  const raw = params['agent']
  if (typeof raw !== 'string' || !MUCKA_AGENT_IDS.includes(raw as AgentId)) {
    throw new Error(
      `agent must be one of: ${MUCKA_AGENT_IDS.join(', ')} — got ${JSON.stringify(raw)}`
    )
  }
  return raw as AgentId
}

function parseString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== 'string') {
    throw new Error(`${key} must be a string — got ${JSON.stringify(v)}`)
  }
  return v
}

function describeAgentLine(cfg: AgentConfig): string {
  const cmd = cfg.command.split('/').pop() || cfg.command
  const attention = cfg.needsAttention
    ? ` [needs Tom${cfg.attentionReason ? `: ${cfg.attentionReason}` : ''}]`
    : ''
  return `${cfg.displayName} — branch "${cfg.branch}" — cwd ${cfg.worktreePath} — running ${cmd} ${cfg.args.join(' ')}${attention}`.trim()
}

function describeGitLine(status: GitStatus): string {
  if (!status.isRepo) {
    return `not a git repo${status.reason ? ` (${status.reason})` : ''}`
  }
  const head = status.branch ?? (status.detachedAt ? '(detached)' : '(unknown)')
  const parts: string[] = [`on ${head}`]
  if (status.hasUpstream) {
    if (status.ahead > 0) parts.push(`${status.ahead} ahead`)
    if (status.behind > 0) parts.push(`${status.behind} behind`)
    if (status.ahead === 0 && status.behind === 0) parts.push('in sync')
  } else {
    parts.push('no upstream')
  }
  const dirty = status.modified + status.staged
  if (dirty > 0) parts.push(`${dirty} dirty`)
  if (status.untracked > 0) parts.push(`${status.untracked} untracked`)
  if (status.conflicted > 0) parts.push(`${status.conflicted} conflicted`)
  return parts.join(' · ')
}

/* ─── Read-only tools (phase 2) ──────────────────────────────────────── */

async function listAgents(): Promise<string> {
  const agents = await window.mucka.listAgents()
  if (agents.length === 0) return 'No agents configured.'
  return agents.map((a, i) => `${i + 1}. ${describeAgentLine(a)}`).join('\n')
}

async function getGitStatus(params: Record<string, unknown>): Promise<string> {
  const agentId = parseAgentId(params)
  const status = await window.mucka.refreshGit(agentId)
  return `${agentId}: ${describeGitLine(status)}`
}

async function getRecentOutput(params: Record<string, unknown>): Promise<string> {
  const agentId = parseAgentId(params)
  const requestedLines =
    typeof params['lines'] === 'number'
      ? Math.max(1, Math.min(200, Math.floor(params['lines'] as number)))
      : 20
  const raw = await window.mucka.getScrollback(agentId)
  const tail = lastLines(raw, requestedLines).trim()
  if (!tail) return `${agentId}: terminal is empty.`
  return `${agentId} — last ${requestedLines} lines:\n${tail}`
}

async function whatsHappening(): Promise<string> {
  const agents = await window.mucka.listAgents()
  if (agents.length === 0) return 'No agents configured.'

  const lines = await Promise.all(
    agents.map(async (a) => {
      const [git, scroll] = await Promise.all([
        window.mucka.refreshGit(a.id),
        window.mucka.getScrollback(a.id)
      ])
      const tail = lastLines(scroll, 3).trim() || '(no recent output)'
      return [
        `── ${a.displayName} (${a.id}) — ${describeGitLine(git)}`,
        `  cwd: ${a.worktreePath}`,
        a.needsAttention ? `  ⚑ NEEDS TOM: ${a.attentionReason ?? '(no reason)'}` : null,
        `  last:`,
        tail.split('\n').map((l) => `    ${l}`).join('\n')
      ]
        .filter((l): l is string => l !== null)
        .join('\n')
    })
  )

  return lines.join('\n\n')
}

/* ─── Auto-execute write tools (phase 3) ─────────────────────────────── */

function makeSetBannerStatus(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const text = parseString(params, 'text').trim()
    if (text.length === 0) {
      deps.setAmbientStatus(null)
      return 'Cleared the banner.'
    }
    deps.setAmbientStatus(text)
    return `Banner set to: ${text}`
  }
}

const VALID_COLOURS: readonly NoticeColour[] = ['cream', 'yellow', 'pink', 'blue']

function makeAddNotice(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const title = parseString(params, 'title')
    const body = parseString(params, 'body')
    const colourRaw = params['colour']
    const colour: NoticeColour =
      typeof colourRaw === 'string' && (VALID_COLOURS as string[]).includes(colourRaw)
        ? (colourRaw as NoticeColour)
        : 'cream'
    const created = await window.mucka.addNotice({ title, body, colour })
    await deps.reloadNotices()
    return `Pinned "${created.title}" to the notice board (${colour}).`
  }
}

function makeRemoveNotice(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const title = parseString(params, 'title')
    const n = await window.mucka.removeNoticeByTitle(title)
    if (n === 0) return `No notice titled "${title}" — nothing to remove.`
    await deps.reloadNotices()
    return `Removed ${n} notice${n === 1 ? '' : 's'} titled "${title}".`
  }
}

function makeFlagAttention(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const reason = parseString(params, 'reason').slice(0, 120)
    await window.mucka.updateAgent({
      id: agentId,
      needsAttention: true,
      attentionReason: reason
    })
    await deps.reloadAgents()
    return `Flagged ${agentId} for Tom — ${reason}`
  }
}

function makeClearAttention(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    await window.mucka.updateAgent({
      id: agentId,
      needsAttention: false,
      attentionReason: null
    })
    await deps.reloadAgents()
    return `Cleared ${agentId}'s attention flag.`
  }
}

/* ─── Confirm-gated write tools (phase 3) ────────────────────────────── */

function makeSetAgentWorktree(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const path = parseString(params, 'path').trim()
    if (!path) throw new Error('path must not be empty')
    const ok = await deps.requestConfirm({
      summary: `Switch ${agentId} to ${path}`,
      note: `Restarts ${agentId}'s shell at the new path.`
    })
    if (!ok) return `Tom said no. ${agentId}'s worktree is unchanged.`
    await window.mucka.updateAgent({ id: agentId, worktreePath: path })
    await deps.reloadAgents()
    return `Done. ${agentId} is now at ${path} (shell restarted).`
  }
}

function makeSetAgentCommand(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const command = parseString(params, 'command').trim()
    if (!command) throw new Error('command must not be empty')
    const argsRaw = typeof params['args'] === 'string' ? (params['args'] as string) : ''
    const args = argsRaw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const argsStr = args.length > 0 ? ` ${args.join(' ')}` : ''
    const ok = await deps.requestConfirm({
      summary: `Switch ${agentId} to run "${command}${argsStr}"`,
      note: `Restarts ${agentId}'s shell.`
    })
    if (!ok) return `Tom said no. ${agentId}'s command is unchanged.`
    await window.mucka.updateAgent({ id: agentId, command, args })
    await deps.reloadAgents()
    return `Done. ${agentId} is now running ${command}${argsStr}.`
  }
}

function makeRestartAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const ok = await deps.requestConfirm({
      summary: `Restart ${agentId}'s shell`,
      note: `Kills the current process and starts a fresh one with the same config.`
    })
    if (!ok) return `Tom said no. ${agentId}'s shell wasn't restarted.`
    deps.bumpRestart(agentId)
    return `Restarted ${agentId}.`
  }
}

/* ─── Composition ────────────────────────────────────────────────────── */

export function buildClientTools(deps: ToolDeps): ClientTools {
  return {
    list_agents: () => listAgents(),
    get_git_status: (params) => getGitStatus(params),
    get_recent_output: (params) => getRecentOutput(params),
    whats_happening: () => whatsHappening(),

    set_banner_status: makeSetBannerStatus(deps),
    add_notice: makeAddNotice(deps),
    remove_notice: makeRemoveNotice(deps),
    flag_attention: makeFlagAttention(deps),
    clear_attention: makeClearAttention(deps),

    set_agent_worktree: makeSetAgentWorktree(deps),
    set_agent_command: makeSetAgentCommand(deps),
    restart_agent: makeRestartAgent(deps)
  }
}
