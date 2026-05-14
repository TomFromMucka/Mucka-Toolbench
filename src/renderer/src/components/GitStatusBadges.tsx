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
    return <span className="text-dirty-grey">checking…</span>
  }

  if (!status.isRepo) {
    return (
      <span className="text-dirty-grey">
        {fallbackLabel || status.reason || 'not a repo'}
      </span>
    )
  }

  const branchName =
    status.branch ?? (status.detachedAt ? '(detached)' : '(unknown)')

  return (
    <span className="flex items-center gap-1.5">
      <span className="truncate font-semibold text-van-white/85">
        {branchName}
      </span>
      {status.ahead > 0 ? (
        <span className={clsx(BADGE, 'bg-van-white/15 text-van-white/90')}>
          ↑{status.ahead}
        </span>
      ) : null}
      {status.behind > 0 ? (
        <span className={clsx(BADGE, 'bg-van-white/15 text-van-white/90')}>
          ↓{status.behind}
        </span>
      ) : null}
      {status.modified + status.staged > 0 ? (
        <span className={clsx(BADGE, 'bg-status-warn/30 text-status-warn')}>
          ●{status.modified + status.staged}
        </span>
      ) : null}
      {status.untracked > 0 ? (
        <span className={clsx(BADGE, 'bg-van-white/20 text-van-white/85')}>
          ?{status.untracked}
        </span>
      ) : null}
      {status.conflicted > 0 ? (
        <span
          className={clsx(BADGE)}
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
        >
          ⚠{status.conflicted}
        </span>
      ) : null}
      {!status.hasUpstream && status.branch ? (
        <span
          className="text-dirty-grey"
          title="No upstream configured"
        >
          ·local
        </span>
      ) : null}
    </span>
  )
}
