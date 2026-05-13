import type { ClientTools } from '@elevenlabs/react'
import type { AgentConfig, AgentId, GitStatus } from '@shared/types'
import { MUCKA_AGENT_IDS } from '@shared/mucka-tools'

/** Strip ANSI escape sequences so the LLM sees readable text, not control codes. */
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

function describeAgentLine(cfg: AgentConfig): string {
  const cmd = cfg.command.split('/').pop() || cfg.command
  return `${cfg.displayName} — branch "${cfg.branch}" — cwd ${cfg.worktreePath} — running ${cmd} ${cfg.args.join(' ')}`.trim()
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

async function listAgents(): Promise<string> {
  const agents = await window.mucka.listAgents()
  if (agents.length === 0) return 'No agents configured.'
  return agents
    .map((a, i) => `${i + 1}. ${describeAgentLine(a)}`)
    .join('\n')
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
        `  last:`,
        tail
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
      ].join('\n')
    })
  )

  return lines.join('\n\n')
}

export function buildClientTools(): ClientTools {
  return {
    list_agents: () => listAgents(),
    get_git_status: (params) => getGitStatus(params),
    get_recent_output: (params) => getRecentOutput(params),
    whats_happening: () => whatsHappening()
  }
}
