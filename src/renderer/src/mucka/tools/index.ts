import type { ClientTools } from '@elevenlabs/react'
import type {
  AgentConfig,
  AgentId,
  GitHubAgentSummary,
  GitStatus,
  JobEvent,
  VercelAgentSummary,
  VercelDeployment
} from '@shared/types'
import { MUCKA_AGENT_IDS } from '@shared/mucka-tools'
import type { ConfirmRequest, EditConfirmRequest } from '../MuckaSessionContext'

interface ToolDeps {
  setAmbientStatus: (text: string | null) => void
  bumpRestart: (agent: AgentId) => void
  requestConfirm: (req: ConfirmRequest) => Promise<boolean>
  requestEditConfirm: (req: EditConfirmRequest) => Promise<string | null>
  /** Pull a fresh agents list from the DB (after a write tool changes one). */
  reloadAgents: () => Promise<void>
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

function describeDeployment(d: VercelDeployment): string {
  const parts: string[] = []
  parts.push(d.state)
  if (d.target === 'production') parts.push('prod')
  if (d.branch) parts.push(`branch ${d.branch}`)
  if (d.commitMessage) {
    const trimmed = d.commitMessage.slice(0, 80)
    parts.push(`"${trimmed}"`)
  }
  if (d.url) parts.push(d.url)
  if (d.state === 'error' && d.errorMessage) parts.push(`err: ${d.errorMessage}`)
  return parts.join(' · ')
}

function describeVercelLine(summary: VercelAgentSummary): string {
  if (summary.source === 'none') return 'no Vercel project linked'
  if (summary.error) return `error: ${summary.error}`
  const target =
    summary.latestForBranch ?? summary.latestProduction ?? summary.latestAny
  if (!target) return 'no deployments yet'
  return describeDeployment(target)
}

function describeGitHubLine(summary: GitHubAgentSummary): string {
  if (!summary.repo) return 'not a GitHub repo'
  if (summary.error) return `error: ${summary.error}`
  const repo = `${summary.repo.owner}/${summary.repo.name}`
  if (!summary.openPr) {
    return `${repo} on ${summary.branch} · no open PR`
  }
  const pr = summary.openPr
  const parts: string[] = [`${repo} #${pr.number}`]
  if (pr.isDraft) parts.push('draft')
  parts.push(`"${pr.title.slice(0, 80)}"`)
  parts.push(`ci ${summary.checkSummary}`)
  if (pr.mergeableState && pr.mergeableState !== 'clean' && pr.mergeableState !== 'unknown') {
    parts.push(`mergeable=${pr.mergeableState}`)
  }
  parts.push(pr.url)
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

async function getVercelStatus(params: Record<string, unknown>): Promise<string> {
  const status = await window.mucka.getVercelStatus()
  if (status.kind === 'missing-token') {
    return 'Vercel API token is not set in the cockpit env — Tom needs to add VERCEL_API_TOKEN to .env and restart.'
  }
  if (status.kind === 'error') return `Vercel: ${status.message}`

  const rawAgent = params['agent']
  if (typeof rawAgent === 'string' && rawAgent.length > 0) {
    const agentId = parseAgentId(params)
    const summary = await window.mucka.refreshVercel(agentId)
    return `${agentId}: ${describeVercelLine(summary)}`
  }

  const all = await window.mucka.listAllVercelDeployments()
  const agents = await window.mucka.listAgents()
  const lines = agents.map((a) => {
    const s = all[a.id]
    if (!s) return `${a.id}: no data`
    return `${a.id}: ${describeVercelLine(s)}`
  })
  return lines.join('\n')
}

async function getPrStatus(params: Record<string, unknown>): Promise<string> {
  const status = await window.mucka.getGitHubStatus()
  if (status.kind === 'missing-token') {
    return 'GitHub token is not set in the cockpit env — Tom needs to add GITHUB_TOKEN to .env and restart.'
  }
  if (status.kind === 'error') return `GitHub: ${status.message}`

  const rawAgent = params['agent']
  if (typeof rawAgent === 'string' && rawAgent.length > 0) {
    const agentId = parseAgentId(params)
    const summary = await window.mucka.refreshGitHub(agentId)
    return `${agentId}: ${describeGitHubLine(summary)}`
  }

  const all = await window.mucka.listAllGitHubSummaries()
  const agents = await window.mucka.listAgents()
  const lines = agents.map((a) => {
    const s = all[a.id]
    if (!s) return `${a.id}: no data`
    return `${a.id}: ${describeGitHubLine(s)}`
  })
  return lines.join('\n')
}

function describeEventLine(event: JobEvent): string {
  const d = new Date(event.ts)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const toneTag = event.tone === 'normal' ? '' : ` [${event.tone}]`
  return `${time} ${event.source}${toneTag}: ${event.message}`
}

async function getRecentEvents(params: Record<string, unknown>): Promise<string> {
  const rawAgent = params['agent']
  const rawLimit = params['limit']
  const limit =
    typeof rawLimit === 'number'
      ? Math.max(1, Math.min(50, Math.floor(rawLimit)))
      : 15

  const events = await window.mucka.listEvents(limit * 2)
  let filtered = events
  if (typeof rawAgent === 'string' && rawAgent.length > 0) {
    const agentId = parseAgentId(params)
    filtered = events.filter((e) => e.source === agentId)
  }
  const slice = filtered.slice(0, limit)
  if (slice.length === 0) return 'No recent events in the job sheet.'
  return slice.map(describeEventLine).join('\n')
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

function makeAppendNote() {
  return async (params: Record<string, unknown>): Promise<string> => {
    const text = parseString(params, 'text').trim()
    if (!text) return 'Empty note — nothing written.'
    await window.mucka.appendNote(text)
    return `Note appended: ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`
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

function makeSetAgentPreview(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const rawUrl = parseString(params, 'url').trim()
    if (rawUrl === '') {
      await window.mucka.updateAgent({ id: agentId, previewUrl: null })
      await deps.reloadAgents()
      return `Cleared ${agentId}'s preview.`
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      throw new Error(`url must start with http:// or https:// — got ${JSON.stringify(rawUrl)}`)
    }
    await window.mucka.updateAgent({ id: agentId, previewUrl: rawUrl })
    await deps.reloadAgents()
    return `Pointed ${agentId}'s preview at ${rawUrl}.`
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

function makeOpenPr(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const draftRaw = params['draft']
    const draft = draftRaw === true || draftRaw === 'true'
    const command = draft ? 'gh pr create --fill --draft' : 'gh pr create --fill'

    const ok = await deps.requestConfirm({
      summary: `Run \`${command}\` in ${agentId}'s terminal`,
      note:
        draft
          ? "Creates a DRAFT pull request from this agent's branch using the gh CLI."
          : "Creates a pull request from this agent's branch using the gh CLI."
    })
    if (!ok) return `Tom said no. No PR opened for ${agentId}.`
    window.mucka.writePty({ terminalId: agentId, data: command + '\r' })
    return `Sent \`${command}\` to ${agentId}. The gh CLI's output will land in its terminal.`
  }
}

function makeDeployToVercel(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const targetRaw = typeof params['target'] === 'string' ? params['target'] : 'preview'
    const target = targetRaw === 'production' || targetRaw === 'prod' ? 'production' : 'preview'
    const command = target === 'production' ? 'vercel --prod' : 'vercel'

    const ok = await deps.requestConfirm({
      summary: `Run \`${command}\` in ${agentId}'s terminal`,
      note:
        target === 'production'
          ? 'Triggers a PRODUCTION deploy from this agent\'s worktree.'
          : 'Triggers a preview deploy from this agent\'s worktree.'
    })
    if (!ok) return `Tom said no. No deploy triggered for ${agentId}.`
    window.mucka.writePty({ terminalId: agentId, data: command + '\r' })
    return `Sent \`${command}\` to ${agentId}. Deploy logs will appear in its terminal.`
  }
}

function makeSendToAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const text = parseString(params, 'text')
    if (!text.trim()) throw new Error('text must not be empty')
    const approved = await deps.requestEditConfirm({
      summary: `Send a message to ${agentId}'s terminal`,
      note: "Will type this and press Enter inside the agent's shell.",
      editable: { text, multiline: true }
    })
    if (approved === null) return `Tom said no. Nothing sent to ${agentId}.`
    const trimmed = approved.trim()
    if (!trimmed) return `Tom blanked the message. Nothing sent to ${agentId}.`
    // Mucka writes to the agent's primary terminal (terminalId === agentId).
    // \r is what terminals receive when you press Enter.
    window.mucka.writePty({ terminalId: agentId, data: trimmed + '\r' })
    return `Sent to ${agentId}: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? '…' : ''}`
  }
}

/* ─── Composition ────────────────────────────────────────────────────── */

export function buildClientTools(deps: ToolDeps): ClientTools {
  return {
    list_agents: () => listAgents(),
    get_git_status: (params) => getGitStatus(params),
    get_recent_output: (params) => getRecentOutput(params),
    whats_happening: () => whatsHappening(),
    get_vercel_status: (params) => getVercelStatus(params),
    get_pr_status: (params) => getPrStatus(params),
    get_recent_events: (params) => getRecentEvents(params),

    set_banner_status: makeSetBannerStatus(deps),
    append_note: makeAppendNote(),
    flag_attention: makeFlagAttention(deps),
    clear_attention: makeClearAttention(deps),
    set_agent_preview: makeSetAgentPreview(deps),

    set_agent_worktree: makeSetAgentWorktree(deps),
    set_agent_command: makeSetAgentCommand(deps),
    restart_agent: makeRestartAgent(deps),
    send_to_agent: makeSendToAgent(deps),
    deploy_to_vercel: makeDeployToVercel(deps),
    open_pr: makeOpenPr(deps)
  }
}
