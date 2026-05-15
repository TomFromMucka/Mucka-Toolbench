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
import { StatusPill, type StatusVariant } from './ui/StatusPill'

const STATE_LABEL: Record<VercelDeploymentState, string> = {
  queued: 'queued',
  building: 'building',
  ready: 'ready',
  error: 'error',
  canceled: 'canceled',
  unknown: '—'
}

/** Map Vercel state → brand StatusPill variant. `error` stays ad-hoc red. */
const STATE_PILL: Record<VercelDeploymentState, StatusVariant | null> = {
  queued: 'scheduled',
  building: 'pending',
  ready: 'completed',
  error: null,
  canceled: 'cancelled',
  unknown: 'cancelled'
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
      <li
        className="t-body-md flex flex-col gap-1 border-b px-3 py-2 leading-snug last:border-b-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="t-label-sm truncate text-dirty-grey">
          {row.agent.displayName.toLowerCase()}
        </span>
        <span className="text-dirty-grey">
          No Vercel project linked — run{' '}
          <span className="font-mono text-[0.78rem]">vercel link</span> in the
          worktree or set a project id in Settings.
        </span>
      </li>
    )
  }

  if (row.kind === 'error') {
    return (
      <li
        className="t-body-md flex items-start gap-2 border-b px-3 py-2 leading-snug last:border-b-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <span className="t-label-sm block truncate text-dirty-grey">
            {row.agent.displayName.toLowerCase()}
          </span>
          <span className="block break-words" style={{ color: 'var(--red)' }}>
            {row.summary.error}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onRefreshAgent(row.agent.id)}
          className="t-label-sm shrink-0 text-dirty-grey hover:text-van-white"
        >
          retry
        </button>
      </li>
    )
  }

  if (row.kind === 'empty') {
    return (
      <li
        className="t-body-md flex flex-col gap-1 border-b px-3 py-2 leading-snug last:border-b-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="t-label-sm truncate text-dirty-grey">
          {agentsLabel(row.agents)}
        </span>
        <span className="text-dirty-grey">
          {projectLabel(null, row.summary.projectId)} · {row.branchLabel} — {row.message}
        </span>
      </li>
    )
  }

  const { deployment } = row
  const pillVariant = STATE_PILL[deployment.state]
  return (
    <li
      className="t-body-md flex flex-col gap-1 border-b px-3 py-2 leading-snug last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="t-label-sm min-w-0 flex-1 truncate text-dirty-grey">
          {agentsLabel(row.agents)}
        </span>
        {pillVariant ? (
          <StatusPill
            variant={pillVariant}
            className={clsx('shrink-0', deployment.state === 'building' && 'animate-pulse')}
          >
            {STATE_LABEL[deployment.state]}
          </StatusPill>
        ) : (
          <span
            className="t-label-sm chamfer-sm shrink-0 px-1.5 py-0.5"
            style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
          >
            {STATE_LABEL[deployment.state]}
          </span>
        )}
        {deployment.url ? (
          <button
            type="button"
            onClick={() => openUrl(deployment.url)}
            className="t-label-sm shrink-0 text-orange hover:underline"
            title={deployment.url}
          >
            open
          </button>
        ) : null}
      </div>
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
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-van-white">
            {deployment.commitMessage ?? '(no commit message)'}
          </span>
          {deployment.isProduction ? (
            <span
              className="t-label-sm chamfer-sm shrink-0 px-1 py-px"
              style={{
                background: 'rgba(234, 233, 232, 0.10)',
                color: 'var(--van-white)'
              }}
            >
              prod
            </span>
          ) : null}
        </div>
        <div className="t-body-sm truncate text-dirty-grey">
          {projectLabel(deployment, row.summary.projectId)} · {row.branchLabel} ·{' '}
          {relativeTime(deployment.createdAt)}
        </div>
      </button>
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
      rightSlot={
        <span className="flex items-center gap-2">
          {errorCount > 0 ? (
            <span
              className="t-label-sm chamfer-sm px-1.5 py-0.5"
              style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
            >
              {errorCount} err
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              for (const a of agents) void refresh(a.id)
            }}
            className="t-label-sm chamfer-sm px-1.5 py-0.5"
            style={{
              background: 'rgba(234, 233, 232, 0.12)',
              color: 'var(--van-white)'
            }}
            title="Refresh all"
          >
            refresh
          </button>
        </span>
      }
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto" style={{ background: 'var(--surface)' }}>
        {tokenMissing ? (
          <div className="t-body-md px-3 py-3 leading-snug text-dirty-grey">
            <p className="font-semibold text-van-white">No Vercel API token.</p>
            <p className="mt-1">
              Add <span className="font-mono text-[0.78rem]">VERCEL_API_TOKEN</span> to{' '}
              <span className="font-mono text-[0.78rem]">.env</span> and restart the
              cockpit. Generate one at vercel.com/account/tokens.
            </p>
          </div>
        ) : null}

        {tokenError ? (
          <div className="t-body-md px-3 py-2" style={{ color: 'var(--red)' }}>
            Vercel: {tokenError}
          </div>
        ) : null}

        {rows.length === 0 && !tokenMissing && !tokenError ? (
          <div className="t-body-md px-3 py-2 text-dirty-grey">
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
