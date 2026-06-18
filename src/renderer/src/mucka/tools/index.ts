import type { ClientTools } from '@elevenlabs/react'
import type {
  AgentConfig,
  AgentId,
  GitHubAgentSummary,
  GitStatus,
  JobEvent,
  MemoryListItem,
  MemoryType,
  RoadmapCard,
  RoadmapColumn,
  VercelAgentSummary,
  VercelDeployment
} from '@shared/types'
import { MUCKA_AGENT_IDS, TOOL_DEFINITIONS } from '@shared/mucka-tools'
import type { ConfirmRequest, EditConfirmRequest } from '../MuckaSessionContext'

const MEMORY_TYPES: readonly MemoryType[] = [
  'profile',
  'preference',
  'project',
  'decision',
  'note'
] as const

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

/**
 * Resolve an agent's human display name for user-facing copy (confirm
 * strips, etc.). Agents are renamed per machine, so we must never show
 * the raw id ("bren") to Tom. Falls back to the id if the lookup fails.
 */
async function agentLabel(agentId: AgentId): Promise<string> {
  try {
    const agents = await window.mucka.listAgents()
    return agents.find((a) => a.id === agentId)?.displayName || agentId
  } catch {
    return agentId
  }
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

function formatMemoryListLine(item: MemoryListItem): string {
  const ago = relativeAgo(item.updatedAt)
  const tagPart = item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : ''
  return `${item.topic} · ${item.type}${tagPart} · ${ago} · ${item.preview}`
}

function relativeAgo(ms: number): string {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function parseMemoryType(raw: unknown, label: string): MemoryType {
  if (typeof raw !== 'string' || !(MEMORY_TYPES as readonly string[]).includes(raw)) {
    throw new Error(
      `${label} must be one of: ${MEMORY_TYPES.join(', ')} — got ${JSON.stringify(raw)}`
    )
  }
  return raw as MemoryType
}

async function listMemoriesHandler(
  params: Record<string, unknown>
): Promise<string> {
  const rawType = params['type']
  const type =
    typeof rawType === 'string' && rawType.length > 0
      ? parseMemoryType(rawType, 'type')
      : undefined
  const tag =
    typeof params['tag'] === 'string' && (params['tag'] as string).trim().length > 0
      ? (params['tag'] as string).trim()
      : undefined
  const limit =
    typeof params['limit'] === 'number'
      ? Math.max(1, Math.min(100, Math.floor(params['limit'] as number)))
      : 50

  const items = await window.mucka.listMemories({ type, tag, limit })
  if (items.length === 0) {
    const filterDesc =
      type || tag ? ` matching ${type ?? ''}${type && tag ? ' + ' : ''}${tag ?? ''}` : ''
    return `No memories yet${filterDesc}.`
  }
  return items.map(formatMemoryListLine).join('\n')
}

async function getMemoryHandler(
  params: Record<string, unknown>
): Promise<string> {
  const topic = parseString(params, 'topic').trim()
  if (!topic) throw new Error('topic must not be empty')
  const memory = await window.mucka.getMemory(topic)
  if (!memory) {
    return `No memory with topic "${topic}". Use list_memories to see what's stored.`
  }
  const tagLine = memory.tags.length > 0 ? `\ntags: ${memory.tags.join(', ')}` : ''
  return [
    `${memory.topic} (${memory.type}) · updated ${relativeAgo(memory.updatedAt)}${tagLine}`,
    '',
    memory.body
  ].join('\n')
}

async function rememberHandler(
  params: Record<string, unknown>
): Promise<string> {
  const topic = parseString(params, 'topic').trim()
  if (!topic) throw new Error('topic must not be empty')
  const type = parseMemoryType(params['type'], 'type')
  const body = parseString(params, 'body').trim()
  if (!body) throw new Error('body must not be empty')
  const rawTags = params['tags']
  const tags =
    typeof rawTags === 'string'
      ? rawTags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : []

  const existing = await window.mucka.getMemory(topic)
  const saved = await window.mucka.rememberMemory({ topic, type, body, tags })
  const verb = existing ? 'Updated' : 'Saved'
  const tagPart = saved.tags.length > 0 ? ` [${saved.tags.join(', ')}]` : ''
  return `${verb} memory "${saved.topic}" (${saved.type})${tagPart}.`
}

function makeForgetHandler(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const topic = parseString(params, 'topic').trim()
    if (!topic) throw new Error('topic must not be empty')
    const existing = await window.mucka.getMemory(topic)
    if (!existing) {
      return `No memory with topic "${topic}" — nothing to forget.`
    }
    const ok = await deps.requestConfirm({
      summary: `Forget memory "${topic}" (${existing.type})`,
      note: existing.body.slice(0, 200) + (existing.body.length > 200 ? '…' : '')
    })
    if (!ok) return `Tom said no. "${topic}" kept.`
    const removed = await window.mucka.forgetMemory(topic)
    return removed
      ? `Forgot "${topic}".`
      : `Tried to forget "${topic}" but it was already gone.`
  }
}

async function getCockpitDoc(params: Record<string, unknown>): Promise<string> {
  const rawSection = params['section']
  const section =
    typeof rawSection === 'string' && rawSection.trim().length > 0
      ? rawSection.trim()
      : undefined
  const doc = await window.mucka.getCockpitDoc(section)
  if (!doc.found && section) {
    const available =
      doc.sections.length > 0
        ? doc.sections.join(', ')
        : '(none — MUCKA.md may be missing)'
    return `No section "${section}" in MUCKA.md. Available sections: ${available}.`
  }
  if (!doc.found) {
    return 'MUCKA.md not found at the cockpit root. Ask Tom — the file should live next to package.json.'
  }
  return doc.text
}

async function getProductDoc(params: Record<string, unknown>): Promise<string> {
  const rawSection = params['section']
  const section =
    typeof rawSection === 'string' && rawSection.trim().length > 0
      ? rawSection.trim()
      : undefined
  const doc = await window.mucka.getProductDoc(section)
  if (!doc.found && section) {
    const available =
      doc.sections.length > 0
        ? doc.sections.join(', ')
        : '(none — PRODUCT.md may be missing or empty)'
    return `No section "${section}" in PRODUCT.md. Available sections: ${available}.`
  }
  if (!doc.found) {
    return "PRODUCT.md not found at the cockpit root. Tom may not have filled it in yet — ask him to populate it, or work from what's already in MUCKA.md."
  }
  return doc.text
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
    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Switch ${label} to ${path}`,
      note: `Restarts ${label}'s shell at the new path.`
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
    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Switch ${label} to run "${command}${argsStr}"`,
      note: `Restarts ${label}'s shell.`
    })
    if (!ok) return `Tom said no. ${agentId}'s command is unchanged.`
    await window.mucka.updateAgent({ id: agentId, command, args })
    await deps.reloadAgents()
    return `Done. ${agentId} is now running ${command}${argsStr}.`
  }
}

function makeStartAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    await window.mucka.startAgent(agentId)
    await deps.reloadAgents()
    return `Started ${agentId}.`
  }
}

function makeStopAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Stop ${label}`,
      note: `Kills the primary shell and every sub-terminal for ${label}. Any unsaved work is lost.`
    })
    if (!ok) return `Tom said no. ${agentId} kept running.`
    await window.mucka.stopAgent(agentId)
    await deps.reloadAgents()
    return `Stopped ${agentId}.`
  }
}

function makeRestartAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Restart ${label}'s shell`,
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

    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Run \`${command}\` in ${label}'s terminal`,
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

    const label = await agentLabel(agentId)
    const ok = await deps.requestConfirm({
      summary: `Run \`${command}\` in ${label}'s terminal`,
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

/* ─── Roadmap kanban tools ───────────────────────────────────────────── */

const ROADMAP_COLUMNS: readonly RoadmapColumn[] = [
  'backlog',
  'next',
  'doing',
  'shipped',
  'parked'
] as const

const ROADMAP_LABEL: Record<RoadmapColumn, string> = {
  backlog: 'Backlog',
  next: 'Next up',
  doing: 'Doing',
  shipped: 'Shipped',
  parked: 'Parked'
}

function parseColumn(raw: unknown, label = 'column'): RoadmapColumn {
  if (typeof raw !== 'string' || !(ROADMAP_COLUMNS as readonly string[]).includes(raw)) {
    throw new Error(
      `${label} must be one of: ${ROADMAP_COLUMNS.join(', ')} — got ${JSON.stringify(raw)}`
    )
  }
  return raw as RoadmapColumn
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

function describeCardLine(card: RoadmapCard): string {
  const bodyExcerpt =
    card.body.trim().length === 0
      ? ''
      : ` — ${card.body.replace(/\s+/g, ' ').trim().slice(0, 100)}${card.body.length > 100 ? '…' : ''}`
  const tagPart = card.tags.length > 0 ? ` [${card.tags.join(', ')}]` : ''
  // Emit the full uuid so move/update/delete round-trip without
  // ambiguity. The backend also accepts unique prefixes as a fallback.
  return `  • ${card.title}${tagPart}\n    id: ${card.id}${bodyExcerpt}`
}

async function listRoadmapHandler(): Promise<string> {
  const cards = await window.mucka.listRoadmap()
  if (cards.length === 0) return 'Roadmap is empty.'
  const lines: string[] = []
  for (const col of ROADMAP_COLUMNS) {
    const inCol = cards
      .filter((c) => c.column === col)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    lines.push(`${ROADMAP_LABEL[col]} (${inCol.length})`)
    if (inCol.length === 0) {
      lines.push('  · empty')
    } else {
      for (const c of inCol) lines.push(describeCardLine(c))
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

async function createRoadmapCardHandler(
  params: Record<string, unknown>
): Promise<string> {
  const title = parseString(params, 'title').trim()
  if (!title) throw new Error('title must not be empty')
  const column = parseColumn(params['column'])
  const body = typeof params['body'] === 'string' ? (params['body'] as string) : ''
  const tags = parseTags(params['tags'])
  const card = await window.mucka.createRoadmapCard({ title, column, body, tags })
  const tagPart = card.tags.length > 0 ? ` [${card.tags.join(', ')}]` : ''
  return `Created card "${card.title}" in ${ROADMAP_LABEL[card.column]}${tagPart} (id ${card.id}).`
}

async function updateRoadmapCardHandler(
  params: Record<string, unknown>
): Promise<string> {
  const id = parseString(params, 'id').trim()
  if (!id) throw new Error('id must not be empty')
  const patch: { id: string; title?: string; body?: string; tags?: string[] } = {
    id
  }
  if (typeof params['title'] === 'string') patch.title = (params['title'] as string).trim()
  if (typeof params['body'] === 'string') patch.body = params['body'] as string
  if (typeof params['tags'] === 'string') patch.tags = parseTags(params['tags'])
  const card = await window.mucka.updateRoadmapCard(patch)
  return `Updated card "${card.title}" (id ${card.id}).`
}

async function moveRoadmapCardHandler(
  params: Record<string, unknown>
): Promise<string> {
  const id = parseString(params, 'id').trim()
  if (!id) throw new Error('id must not be empty')
  const column = parseColumn(params['column'])
  const card = await window.mucka.moveRoadmapCard({ id, column })
  return `Moved "${card.title}" to ${ROADMAP_LABEL[card.column]}.`
}

function makeDeleteRoadmapCard(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const id = parseString(params, 'id').trim()
    if (!id) throw new Error('id must not be empty')
    const cards = await window.mucka.listRoadmap()
    const target =
      cards.find((c) => c.id === id) ??
      cards.find((c) => c.id.startsWith(id))
    if (!target) return `No card with id ${id} — nothing to delete.`
    const ok = await deps.requestConfirm({
      summary: `Delete card "${target.title}"`,
      note: `From ${ROADMAP_LABEL[target.column]}. ${
        target.body.trim().length > 0
          ? target.body.replace(/\s+/g, ' ').trim().slice(0, 150)
          : 'No description.'
      }`
    })
    if (!ok) return `Tom said no. "${target.title}" kept.`
    const removed = await window.mucka.deleteRoadmapCard(id)
    return removed
      ? `Deleted "${target.title}".`
      : `Tried to delete "${target.title}" but it was already gone.`
  }
}

async function readPrDiffHandler(params: Record<string, unknown>): Promise<string> {
  const agentId = parseAgentId(params)
  const ctx = await window.mucka.fetchPrReviewContext(agentId)
  if (!ctx.found) {
    return ctx.error ?? `No open PR for ${agentId}.`
  }
  const pr = ctx.pr!
  const repo = ctx.repo!
  const header = [
    `PR: ${repo.owner}/${repo.name} #${pr.number} — ${pr.title}`,
    `Branch: ${pr.headBranch} → ${pr.baseBranch}`,
    `Author: ${pr.authorLogin ?? '(unknown)'}`,
    `State: ${pr.state}${pr.isDraft ? ' (draft)' : ''}`,
    `Mergeable: ${pr.mergeableState ?? '(unknown)'} · mergeable=${pr.mergeable ?? '?'}`,
    `URL: ${pr.url}`,
    ctx.diffTruncated
      ? '⚠ diff truncated — comment on what you can read, ask Tom to point you at specific files if you need the rest.'
      : null,
    '',
    '--- DIFF ---',
    ''
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
  return header + ctx.diff
}

function makePostPrReview(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const verdictRaw = parseString(params, 'verdict').trim().toLowerCase()
    if (
      verdictRaw !== 'approve' &&
      verdictRaw !== 'request-changes' &&
      verdictRaw !== 'comment'
    ) {
      throw new Error(
        `verdict must be approve / request-changes / comment — got ${verdictRaw}`
      )
    }
    const body = parseString(params, 'body')
    if (!body.trim()) throw new Error('body must not be empty')

    const verdictLabel =
      verdictRaw === 'approve'
        ? 'APPROVE'
        : verdictRaw === 'request-changes'
          ? 'REQUEST CHANGES'
          : 'COMMENT'
    const label = await agentLabel(agentId)
    const approved = await deps.requestEditConfirm({
      summary: `${verdictLabel} on ${label}'s PR`,
      note:
        'Mucka has read the diff and drafted this review. Tweak the wording if you want — it submits to GitHub on approve.',
      editable: { text: body, multiline: true }
    })
    if (approved === null) return `Tom said no. No review posted for ${agentId}.`
    const finalBody = approved.trim()
    if (!finalBody) return `Tom blanked the review. No review posted for ${agentId}.`

    try {
      const result = await window.mucka.submitPrReview({
        agentId,
        verdict: verdictRaw as 'approve' | 'request-changes' | 'comment',
        body: finalBody
      })
      return `Posted ${verdictLabel.toLowerCase()} on ${agentId}'s PR — ${result.url}`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `Review failed: ${message}`
    }
  }
}

function makeBroadcastToAgents(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const text = parseString(params, 'text')
    if (!text.trim()) throw new Error('text must not be empty')

    let targetIds: AgentId[] | undefined
    if (typeof params['agents'] === 'string' && (params['agents'] as string).trim().length > 0) {
      const raw = (params['agents'] as string)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
      const invalid = raw.filter(
        (s) => !MUCKA_AGENT_IDS.includes(s as AgentId)
      )
      if (invalid.length > 0) {
        throw new Error(
          `agents must be from: ${MUCKA_AGENT_IDS.join(', ')} — got ${invalid.join(', ')}`
        )
      }
      targetIds = raw as AgentId[]
    }

    const targetLabel = targetIds
      ? (await Promise.all(targetIds.map(agentLabel))).join(', ')
      : 'every running agent'
    const approved = await deps.requestEditConfirm({
      summary: `Broadcast to ${targetLabel}`,
      note: 'Will type this and press Enter in each agent\'s shell.',
      editable: { text, multiline: true }
    })
    if (approved === null) return `Tom said no. Broadcast cancelled.`
    const trimmed = approved.trim()
    if (!trimmed) return `Tom blanked the message. Broadcast cancelled.`

    const result = await window.mucka.broadcastToAgents({
      text: trimmed,
      agentIds: targetIds
    })
    if (result.sent.length === 0) {
      return result.skipped.length > 0
        ? `No live shells — skipped ${result.skipped.join(', ')}.`
        : 'No running agents to broadcast to.'
    }
    const skippedPart =
      result.skipped.length > 0
        ? ` (skipped ${result.skipped.join(', ')} — no live shell)`
        : ''
    return `Broadcast to ${result.sent.join(', ')}: ${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}${skippedPart}`
  }
}

function makeSendToAgent(deps: ToolDeps) {
  return async (params: Record<string, unknown>): Promise<string> => {
    const agentId = parseAgentId(params)
    const text = parseString(params, 'text')
    if (!text.trim()) throw new Error('text must not be empty')
    const label = await agentLabel(agentId)
    const approved = await deps.requestEditConfirm({
      summary: `Send a message to ${label}'s terminal`,
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
    self_test: () =>
      `Tool dispatch OK — ${TOOL_DEFINITIONS.length} cockpit tools reachable: ` +
      TOOL_DEFINITIONS.map((t) => t.name).join(', '),
    recall: (params) =>
      window.mucka.searchHistory(
        typeof params.query === 'string' ? params.query : '',
        typeof params.limit === 'number' ? params.limit : undefined
      ),
    list_agents: () => listAgents(),
    get_git_status: (params) => getGitStatus(params),
    get_recent_output: (params) => getRecentOutput(params),
    whats_happening: () => whatsHappening(),
    get_vercel_status: (params) => getVercelStatus(params),
    get_pr_status: (params) => getPrStatus(params),
    get_recent_events: (params) => getRecentEvents(params),
    get_cockpit_doc: (params) => getCockpitDoc(params),
    get_product_doc: (params) => getProductDoc(params),
    list_memories: (params) => listMemoriesHandler(params),
    get_memory: (params) => getMemoryHandler(params),
    remember: (params) => rememberHandler(params),
    forget: makeForgetHandler(deps),

    set_banner_status: makeSetBannerStatus(deps),
    append_note: makeAppendNote(),
    flag_attention: makeFlagAttention(deps),
    clear_attention: makeClearAttention(deps),
    set_agent_preview: makeSetAgentPreview(deps),

    start_agent: makeStartAgent(deps),
    stop_agent: makeStopAgent(deps),
    set_agent_worktree: makeSetAgentWorktree(deps),
    set_agent_command: makeSetAgentCommand(deps),
    restart_agent: makeRestartAgent(deps),
    send_to_agent: makeSendToAgent(deps),
    broadcast_to_agents: makeBroadcastToAgents(deps),
    read_pr_diff: (params) => readPrDiffHandler(params),
    post_pr_review: makePostPrReview(deps),
    deploy_to_vercel: makeDeployToVercel(deps),
    open_pr: makeOpenPr(deps),

    list_roadmap: () => listRoadmapHandler(),
    create_roadmap_card: (params) => createRoadmapCardHandler(params),
    update_roadmap_card: (params) => updateRoadmapCardHandler(params),
    move_roadmap_card: (params) => moveRoadmapCardHandler(params),
    delete_roadmap_card: makeDeleteRoadmapCard(deps)
  }
}
