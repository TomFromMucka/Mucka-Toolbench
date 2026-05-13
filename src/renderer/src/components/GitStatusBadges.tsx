import clsx from 'clsx'
import type { GitStatus } from '@shared/types'

interface GitStatusBadgesProps {
  status: GitStatus | undefined
  /** Label fallback when there's no git data (used in dev when cwd is $HOME). */
  fallbackLabel: string
}

const BADGE = 'inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[0.62rem] font-semibold tabular-nums tracking-wide'

export function GitStatusBadges({
  status,
  fallbackLabel
}: GitStatusBadgesProps): React.JSX.Element {
  if (!status) {
    return <span className="text-paper-cream/45">checking…</span>
  }

  if (!status.isRepo) {
    return (
      <span className="text-paper-cream/45">
        {fallbackLabel || status.reason || 'not a repo'}
      </span>
    )
  }

  const branchName =
    status.branch ?? (status.detachedAt ? '(detached)' : '(unknown)')

  return (
    <span className="flex items-center gap-1.5">
      <span className="truncate font-semibold text-paper-cream/85">
        {branchName}
      </span>
      {status.ahead > 0 ? (
        <span className={clsx(BADGE, 'bg-paper-cream/15 text-paper-cream/90')}>
          ↑{status.ahead}
        </span>
      ) : null}
      {status.behind > 0 ? (
        <span className={clsx(BADGE, 'bg-paper-cream/15 text-paper-cream/90')}>
          ↓{status.behind}
        </span>
      ) : null}
      {status.modified + status.staged > 0 ? (
        <span className={clsx(BADGE, 'bg-status-warn/80 text-ink')}>
          ●{status.modified + status.staged}
        </span>
      ) : null}
      {status.untracked > 0 ? (
        <span className={clsx(BADGE, 'bg-paper-cream/20 text-paper-cream/85')}>
          ?{status.untracked}
        </span>
      ) : null}
      {status.conflicted > 0 ? (
        <span className={clsx(BADGE, 'bg-status-bad text-paper-cream')}>
          ⚠{status.conflicted}
        </span>
      ) : null}
      {!status.hasUpstream && status.branch ? (
        <span
          className="text-paper-cream/45"
          title="No upstream configured"
        >
          ·local
        </span>
      ) : null}
    </span>
  )
}
