import clsx from 'clsx'
import type {
  AgentConfig,
  AgentId,
  VercelAgentSummary,
  VercelDeployment,
  VercelDeploymentState
} from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { useVercelState } from '../state/VercelContext'
import { Clipboard } from './Clipboard'

const STATE_LABEL: Record<VercelDeploymentState, string> = {
  queued: 'queued',
  building: 'building',
  ready: 'ready',
  error: 'error',
  canceled: 'canceled',
  unknown: '—'
}

const STATE_PILL: Record<VercelDeploymentState, string> = {
  queued: 'bg-ink-faint text-paper-cream',
  building: 'bg-status-warn text-ink animate-pulse',
  ready: 'bg-status-ok text-ink',
  error: 'bg-status-bad text-paper-cream',
  canceled: 'bg-ink-faint/60 text-paper-cream',
  unknown: 'bg-ink-faint/60 text-paper-cream'
}

function relativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function openUrl(url: string | null | undefined): void {
  if (!url) return
  void window.open(url, '_blank', 'noopener,noreferrer')
}

function pickDisplayDeployment(
  summary: VercelAgentSummary | undefined
): VercelDeployment | null {
  if (!summary) return null
  return summary.latestForBranch ?? summary.latestProduction ?? summary.latestAny
}

interface GroupKey {
  /** Composite key used for memberhip checks. */
  key: string
  projectId: string
  branch: string
}

/**
 * One row in the panel — either a single agent's "no project linked" /
 * error row, or a deployment shared by N agents on the same project+branch.
 */
type Row =
  | {
      kind: 'deployment'
      key: string
      agents: AgentConfig[]
      summary: VercelAgentSummary
      deployment: VercelDeployment
      branchLabel: string
    }
  | {
      kind: 'empty'
      key: string
      agents: AgentConfig[]
      summary: VercelAgentSummary
      branchLabel: string
      message: string
    }
  | {
      kind: 'unlinked'
      key: string
      agent: AgentConfig
    }
  | {
      kind: 'error'
      key: string
      agent: AgentConfig
      summary: VercelAgentSummary
    }

function makeGroupKey(projectId: string, branch: string): GroupKey {
  return { key: `${projectId}::${branch}`, projectId, branch }
}

function buildRows(
  agents: AgentConfig[],
  summaries: Partial<Record<AgentId, VercelAgentSummary>>
): Row[] {
  const groups = new Map<string, { agents: AgentConfig[]; summary: VercelAgentSummary; branch: string }>()
  const rows: Row[] = []

  for (const agent of agents) {
    const summary = summaries[agent.id]
    if (!summary) continue
    if (summary.source === 'none') {
      rows.push({ kind: 'unlinked', key: `unlinked::${agent.id}`, agent })
      continue
    }
    if (summary.error) {
      rows.push({
        kind: 'error',
        key: `err::${agent.id}`,
        agent,
        summary
      })
      continue
    }
    if (!summary.projectId) {
      rows.push({ kind: 'unlinked', key: `unlinked::${agent.id}`, agent })
      continue
    }
    const gk = makeGroupKey(summary.projectId, agent.branch)
    const existing = groups.get(gk.key)
    if (existing) {
      existing.agents.push(agent)
    } else {
      groups.set(gk.key, { agents: [agent], summary, branch: agent.branch })
    }
  }

  for (const [key, group] of groups) {
    const deployment = pickDisplayDeployment(group.summary)
    if (deployment) {
      rows.push({
        kind: 'deployment',
        key,
        agents: group.agents,
        summary: group.summary,
        deployment,
        branchLabel: group.branch
      })
    } else {
      rows.push({
        kind: 'empty',
        key,
        agents: group.agents,
        summary: group.summary,
        branchLabel: group.branch,
        message: 'No deployments yet on this project.'
      })
    }
  }

  return rows
}

function agentsLabel(agents: AgentConfig[]): string {
  return agents.map((a) => a.displayName.toLowerCase()).join(' · ')
}

function projectLabel(deployment: VercelDeployment | null, projectId: string | null): string {
  if (deployment?.projectName) return deployment.projectName
  if (projectId) return projectId
  return ''
}

interface RowProps {
  row: Row
  onRefreshAgent: (agentId: AgentId) => void
}

function VercelRow({ row, onRefreshAgent }: RowProps): React.JSX.Element {
  if (row.kind === 'unlinked') {
    return (
      <li className="flex items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug last:border-b-0">
        <span className="w-12 shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
          {row.agent.displayName.toLowerCase()}
        </span>
        <span className="flex-1 text-ink-faint">
          No Vercel project linked — run{' '}
          <span className="font-mono text-[0.78rem]">vercel link</span> in the
          worktree or set a project id in Settings.
        </span>
      </li>
    )
  }

  if (row.kind === 'error') {
    return (
      <li className="flex items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug last:border-b-0">
        <span className="w-12 shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
          {row.agent.displayName.toLowerCase()}
        </span>
        <span className="flex-1 text-status-bad">{row.summary.error}</span>
        <button
          type="button"
          onClick={() => onRefreshAgent(row.agent.id)}
          className="shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-soft hover:text-ink"
        >
          retry
        </button>
      </li>
    )
  }

  if (row.kind === 'empty') {
    return (
      <li className="flex items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug last:border-b-0">
        <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
          {agentsLabel(row.agents)}
        </span>
        <span className="ml-2 flex-1 text-ink-faint">
          {projectLabel(null, row.summary.projectId)} · {row.branchLabel} — {row.message}
        </span>
      </li>
    )
  }

  const { deployment } = row
  return (
    <li className="grid grid-cols-[auto_64px_1fr_auto] items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.92rem] leading-snug last:border-b-0">
      <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
        {agentsLabel(row.agents)}
      </span>
      <span
        className={clsx(
          'inline-flex justify-center rounded-sm px-1.5 py-px text-[0.6rem] uppercase tracking-wider font-sans',
          STATE_PILL[deployment.state]
        )}
      >
        {STATE_LABEL[deployment.state]}
      </span>
      <button
        type="button"
        onClick={() => openUrl(deployment.inspectorUrl ?? deployment.url)}
        className="min-w-0 text-left"
        title={
          deployment.commitMessage
            ? `${deployment.commitMessage} (${deployment.commitSha?.slice(0, 7) ?? ''})`
            : 'Open in Vercel dashboard'
        }
      >
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-ink">
            {deployment.commitMessage ?? '(no commit message)'}
          </span>
          {deployment.isProduction ? (
            <span className="rounded-sm bg-ink/15 px-1 py-px text-[0.55rem] uppercase tracking-wide text-ink-soft font-sans">
              prod
            </span>
          ) : null}
        </div>
        <div className="truncate text-[0.74rem] text-ink-faint font-sans">
          {projectLabel(deployment, row.summary.projectId)} · {row.branchLabel} ·{' '}
          {relativeTime(deployment.createdAt)}
        </div>
      </button>
      {deployment.url ? (
        <button
          type="button"
          onClick={() => openUrl(deployment.url)}
          className="shrink-0 text-[0.7rem] uppercase tracking-wide text-mucka-deep hover:underline font-sans"
          title={deployment.url}
        >
          open
        </button>
      ) : null}
    </li>
  )
}

export function VercelPanel(): React.JSX.Element {
  const { agents } = useAgentsState()
  const { status, summaries, refresh } = useVercelState()

  const tokenMissing = status?.kind === 'missing-token'
  const tokenError = status?.kind === 'error' ? status.message : null

  const rows = buildRows(agents, summaries)

  const errorCount = rows.filter(
    (r) =>
      r.kind === 'deployment' &&
      (r.deployment.state === 'error' || r.deployment.state === 'canceled')
  ).length

  return (
    <Clipboard
      title="Vercel"
      subtitle={
        tokenMissing
          ? 'token missing'
          : tokenError
            ? 'error'
            : 'latest deployments'
      }
      paper="lined"
      rightSlot={
        <span className="flex items-center gap-2">
          {errorCount > 0 ? (
            <span className="rounded-sm bg-status-bad px-1.5 py-px text-[0.62rem] uppercase tracking-wide text-paper-cream">
              {errorCount} err
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              for (const a of agents) void refresh(a.id)
            }}
            className="rounded-sm border border-paper-cream/30 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-paper-cream/85 hover:bg-paper-cream/15"
            title="Refresh all"
          >
            refresh
          </button>
        </span>
      }
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto">
        {tokenMissing ? (
          <div className="px-3 py-3 font-[var(--font-hand)] text-[0.88rem] leading-snug text-ink-soft">
            <p className="font-semibold text-ink">No Vercel API token.</p>
            <p className="mt-1">
              Add <span className="font-mono text-[0.78rem]">VERCEL_API_TOKEN</span> to{' '}
              <span className="font-mono text-[0.78rem]">.env</span> and restart the
              cockpit. Generate one at vercel.com/account/tokens.
            </p>
          </div>
        ) : null}

        {tokenError ? (
          <div className="px-3 py-2 font-[var(--font-hand)] text-[0.88rem] text-status-bad">
            Vercel: {tokenError}
          </div>
        ) : null}

        {rows.length === 0 && !tokenMissing && !tokenError ? (
          <div className="px-3 py-2 font-[var(--font-hand)] text-[0.88rem] text-ink-faint">
            Waiting for first poll…
          </div>
        ) : null}

        <ul>
          {rows.map((row) => (
            <VercelRow
              key={row.key}
              row={row}
              onRefreshAgent={(id) => void refresh(id)}
            />
          ))}
        </ul>
      </div>
    </Clipboard>
  )
}
