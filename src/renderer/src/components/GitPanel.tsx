import clsx from 'clsx'
import type {
  AgentConfig,
  AgentId,
  CheckSummary,
  GitHubAgentSummary,
  PullRequest
} from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { useGitHubState } from '../state/GitHubContext'
import { Clipboard } from './Clipboard'

const CHECK_LABEL: Record<CheckSummary, string> = {
  success: 'ci ✓',
  failure: 'ci ✗',
  pending: 'ci…',
  none: 'no ci'
}

const CHECK_PILL: Record<CheckSummary, string> = {
  success: 'bg-status-ok text-ink',
  failure: 'bg-status-bad text-paper-cream',
  pending: 'bg-status-warn text-ink animate-pulse',
  none: 'bg-ink-faint/60 text-paper-cream'
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

function mergeableLabel(pr: PullRequest): string | null {
  if (pr.mergeableState === null || pr.mergeableState === undefined) return null
  if (pr.mergeableState === 'clean') return null
  if (pr.mergeableState === 'unknown') return null
  return pr.mergeableState
}

type Row =
  | {
      kind: 'pr'
      key: string
      agents: AgentConfig[]
      summary: GitHubAgentSummary
      pr: PullRequest
    }
  | {
      kind: 'no-pr'
      key: string
      agents: AgentConfig[]
      summary: GitHubAgentSummary
    }
  | { kind: 'no-repo'; key: string; agent: AgentConfig }
  | {
      kind: 'error'
      key: string
      agent: AgentConfig
      summary: GitHubAgentSummary
    }

function buildRows(
  agents: AgentConfig[],
  summaries: Partial<Record<AgentId, GitHubAgentSummary>>
): Row[] {
  const groups = new Map<
    string,
    { agents: AgentConfig[]; summary: GitHubAgentSummary }
  >()
  const rows: Row[] = []

  for (const agent of agents) {
    const summary = summaries[agent.id]
    if (!summary) continue
    if (!summary.repo) {
      rows.push({ kind: 'no-repo', key: `no-repo::${agent.id}`, agent })
      continue
    }
    if (summary.error) {
      rows.push({ kind: 'error', key: `err::${agent.id}`, agent, summary })
      continue
    }
    const key = `${summary.repo.owner}/${summary.repo.name}::${agent.branch}`
    const existing = groups.get(key)
    if (existing) existing.agents.push(agent)
    else groups.set(key, { agents: [agent], summary })
  }

  for (const [key, group] of groups) {
    if (group.summary.openPr) {
      rows.push({
        kind: 'pr',
        key,
        agents: group.agents,
        summary: group.summary,
        pr: group.summary.openPr
      })
    } else {
      rows.push({
        kind: 'no-pr',
        key,
        agents: group.agents,
        summary: group.summary
      })
    }
  }

  return rows
}

function agentsLabel(agents: AgentConfig[]): string {
  return agents.map((a) => a.displayName.toLowerCase()).join(' · ')
}

function repoLabel(summary: GitHubAgentSummary): string {
  if (!summary.repo) return ''
  return `${summary.repo.owner}/${summary.repo.name}`
}

interface RowProps {
  row: Row
  onRefreshAgent: (agentId: AgentId) => void
}

function GitRow({ row, onRefreshAgent }: RowProps): React.JSX.Element {
  if (row.kind === 'no-repo') {
    return (
      <li className="flex items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug last:border-b-0">
        <span className="w-12 shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
          {row.agent.displayName.toLowerCase()}
        </span>
        <span className="flex-1 text-ink-faint">
          Worktree origin isn&apos;t a GitHub repo.
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

  if (row.kind === 'no-pr') {
    return (
      <li className="flex items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.9rem] leading-snug last:border-b-0">
        <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
          {agentsLabel(row.agents)}
        </span>
        <span className="ml-2 flex-1 text-ink-faint">
          {repoLabel(row.summary)} · {row.summary.branch} — no open PR
        </span>
      </li>
    )
  }

  const { pr, summary } = row
  const mergeable = mergeableLabel(pr)
  return (
    <li className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-2 border-b border-ink/10 px-3 py-1.5 font-[var(--font-hand)] text-[0.92rem] leading-snug last:border-b-0">
      <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-ink-faint font-sans">
        {agentsLabel(row.agents)}
      </span>
      <span
        className={clsx(
          'inline-flex justify-center rounded-sm px-1.5 py-px text-[0.6rem] uppercase tracking-wider font-sans',
          CHECK_PILL[summary.checkSummary]
        )}
      >
        {CHECK_LABEL[summary.checkSummary]}
      </span>
      <button
        type="button"
        onClick={() => openUrl(pr.url)}
        className="min-w-0 text-left"
        title={`#${pr.number} · ${pr.headBranch} → ${pr.baseBranch}`}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-ink-faint font-sans text-[0.78rem]">
            #{pr.number}
          </span>
          <span className="truncate text-ink">{pr.title}</span>
          {pr.isDraft ? (
            <span className="rounded-sm bg-ink/15 px-1 py-px text-[0.55rem] uppercase tracking-wide text-ink-soft font-sans">
              draft
            </span>
          ) : null}
          {mergeable ? (
            <span className="rounded-sm bg-status-warn/40 px-1 py-px text-[0.55rem] uppercase tracking-wide text-ink-soft font-sans">
              {mergeable}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[0.74rem] text-ink-faint font-sans">
          {repoLabel(summary)} · {summary.branch} → {pr.baseBranch} ·{' '}
          {relativeTime(pr.updatedAt || pr.createdAt)}
        </div>
      </button>
      <button
        type="button"
        onClick={() => openUrl(pr.url)}
        className="shrink-0 text-[0.7rem] uppercase tracking-wide text-mucka-deep hover:underline font-sans"
        title={pr.url}
      >
        open
      </button>
    </li>
  )
}

export function GitPanel(): React.JSX.Element {
  const { agents } = useAgentsState()
  const { status, summaries, refresh } = useGitHubState()

  const tokenMissing = status?.kind === 'missing-token'
  const tokenError = status?.kind === 'error' ? status.message : null
  const rows = buildRows(agents, summaries)

  const failCount = rows.filter(
    (r) => r.kind === 'pr' && r.summary.checkSummary === 'failure'
  ).length

  return (
    <Clipboard
      title="Git"
      subtitle={
        tokenMissing
          ? 'token missing'
          : tokenError
            ? 'error'
            : 'open PRs · CI'
      }
      paper="lined"
      rightSlot={
        <span className="flex items-center gap-2">
          {failCount > 0 ? (
            <span className="rounded-sm bg-status-bad px-1.5 py-px text-[0.62rem] uppercase tracking-wide text-paper-cream">
              {failCount} fail
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
            <p className="font-semibold text-ink">No GitHub token.</p>
            <p className="mt-1">
              Add <span className="font-mono text-[0.78rem]">GITHUB_TOKEN</span> to{' '}
              <span className="font-mono text-[0.78rem]">.env</span> and restart.
              Fine-grained PAT with repo read access works fine.
            </p>
          </div>
        ) : null}

        {tokenError ? (
          <div className="px-3 py-2 font-[var(--font-hand)] text-[0.88rem] text-status-bad">
            GitHub: {tokenError}
          </div>
        ) : null}

        {rows.length === 0 && !tokenMissing && !tokenError ? (
          <div className="px-3 py-2 font-[var(--font-hand)] text-[0.88rem] text-ink-faint">
            Waiting for first poll…
          </div>
        ) : null}

        <ul>
          {rows.map((row) => (
            <GitRow
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
