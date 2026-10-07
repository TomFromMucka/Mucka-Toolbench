import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { Agent, AgentConfig, AgentId, AgentStatus, GitStatus } from '@shared/types'
import { AgentClipboard } from '../components/AgentClipboard'
import { Clipboard } from '../components/Clipboard'
import { NeedsYouCard } from '../components/NeedsYouCard'
import { useAgentSlots } from '../hooks/useAgentSlots'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useAgentStatuses } from '../state/AgentStatusContext'
import { useGitHubState } from '../state/GitHubContext'
import { useFocusRequests, useNeedsYou } from '../state/NeedsYouContext'

/**
 * The Jobs layout's middle three columns: who needs Tom, a board of what
 * every agent is on, and the selected job's terminal at full size.
 *
 * Until jobs exist as their own records (slice 4 of
 * docs/jobs-layout-plan.md), each agent is a job, its branch or PR is the
 * job's title, and Claude's reported status decides its lane.
 */

type Lane = 'waiting' | 'working' | 'check' | 'idle'

const LANES: { lane: Lane; title: string; empty: string }[] = [
  { lane: 'waiting', title: 'Waiting on you', empty: 'Nobody needs you.' },
  { lane: 'working', title: 'On the tools', empty: 'Nobody is working.' },
  { lane: 'check', title: 'Check it', empty: 'Nothing finished to look at.' },
  { lane: 'idle', title: 'Idle', empty: 'Everyone has something to do.' }
]

const WORKING: AgentStatus[] = ['thinking', 'editing', 'running']

function changedFiles(git: GitStatus | undefined): number {
  return git ? git.modified + git.staged + git.untracked : 0
}

/** `feat/repeating-appointments` → "Repeating appointments". */
function readableBranch(branch: string | null): string | null {
  if (!branch || branch === 'main' || branch === 'master' || branch.startsWith('slot/')) return null
  const words = branch
    .replace(/^[a-z]+\//, '')
    .replace(/[-_/]+/g, ' ')
    .trim()
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : null
}

interface JobsLayoutProps {
  agents: AgentConfig[]
  gitStatus: GitStatusMap
  restartVersion: Partial<Record<Agent['id'], number>>
  selected: AgentId | null
  onSelect: (agentId: AgentId) => void
}

export function JobsLayout({
  agents,
  gitStatus,
  restartVersion,
  selected,
  onSelect
}: JobsLayoutProps): React.JSX.Element {
  const { queue, placeOf } = useNeedsYou()
  const { statusFor } = useAgentStatuses()
  const { summaries } = useGitHubState()
  const slotFor = useAgentSlots(gitStatus, restartVersion)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // ⌘J and "Open terminal" name a terminal; in this layout that also means
  // "make that agent the job on screen". Split tabs are `<agent>:t<n>`.
  useFocusRequests(
    useCallback(
      (terminalId: string) => {
        const agentId = agents.find((a) => a.id === terminalId.split(':')[0])?.id
        if (agentId) onSelect(agentId)
      },
      [agents, onSelect]
    )
  )

  const current = selected

  const laneOf = (cfg: AgentConfig): Lane => {
    if (placeOf(cfg.id) !== null) return 'waiting'
    if (!cfg.running) return 'idle'
    if (WORKING.includes(statusFor(cfg.id))) return 'working'
    const git = gitStatus[cfg.id]
    const hasWork =
      changedFiles(git) > 0 || (git?.ahead ?? 0) > 0 || Boolean(summaries[cfg.id]?.openPr)
    return hasWork ? 'check' : 'idle'
  }

  const byLane = new Map<Lane, AgentConfig[]>(LANES.map((l) => [l.lane, []]))
  for (const cfg of agents) byLane.get(laneOf(cfg))?.push(cfg)
  // Waiting lane follows queue order, so the board and the column agree.
  byLane.get('waiting')?.sort((a, b) => (placeOf(a.id) ?? 0) - (placeOf(b.id) ?? 0))

  return (
    <>
      <Clipboard title="Needs you" subtitle="blocked first, oldest first" bodyClassName="min-h-0">
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
          {queue.length === 0 ? (
            <span className="t-body-sm px-1 py-2 text-dirty-grey">
              Nobody is waiting on you. Questions and permission prompts land here as they come in.
            </span>
          ) : (
            queue.map((entry, i) => (
              <NeedsYouCard
                key={entry.pending?.id ?? entry.agentId}
                entry={entry}
                place={i + 1}
                now={now}
              />
            ))
          )}
        </div>
      </Clipboard>

      <Clipboard title="Job board" subtitle="what everyone is on" bodyClassName="min-h-0">
        <div className="grid h-full min-h-0 grid-cols-4 gap-2 overflow-y-auto p-2">
          {LANES.map(({ lane, title, empty }) => {
            const list = byLane.get(lane) ?? []
            return (
              <div key={lane} className="flex min-w-0 flex-col gap-1.5">
                <div
                  className="t-label-sm flex justify-between px-1 pb-1 text-dirty-grey"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <span>{title}</span>
                  <span>{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <span className="t-body-sm px-1 text-dirty-grey">{empty}</span>
                ) : (
                  list.map((cfg) => (
                    <JobCard
                      key={cfg.id}
                      cfg={cfg}
                      git={gitStatus[cfg.id]}
                      prTitle={summaries[cfg.id]?.openPr?.title ?? null}
                      prNumber={summaries[cfg.id]?.openPr?.number ?? null}
                      status={statusFor(cfg.id)}
                      place={placeOf(cfg.id)}
                      selected={cfg.id === current}
                      onSelect={() => onSelect(cfg.id)}
                    />
                  ))
                )}
              </div>
            )
          })}
        </div>
      </Clipboard>

      {/*
        Every agent's clipboard stays mounted, stacked in one cell, and only
        the selected one is visible. Switching jobs must not remount: a
        remount throws the xterm away (scrollback replay, "reconnected"
        banner, split tabs collapsing). `invisible` rather than `hidden`
        keeps each terminal its real size, so it doesn't refit to zero.
      */}
      <div className="grid min-h-0 min-w-0">
        {agents.map((cfg) => {
          const slot = slotFor(cfg)
          if (!slot) return null
          const shown = cfg.id === current
          return (
            <div
              key={slot.key}
              className={clsx(
                'col-start-1 row-start-1 grid min-h-0 min-w-0',
                !shown && 'pointer-events-none invisible'
              )}
              aria-hidden={!shown}
            >
              <AgentClipboard
                agent={slot.agent}
                config={slot.config}
                gitStatus={slot.gitStatus}
                contextUsedPercent={slot.contextUsedPercent}
                model={slot.model}
              />
            </div>
          )
        })}
      </div>
    </>
  )
}

interface JobCardProps {
  cfg: AgentConfig
  git: GitStatus | undefined
  prTitle: string | null
  prNumber: number | null
  status: AgentStatus
  place: number | null
  selected: boolean
  onSelect: () => void
}

function JobCard({
  cfg,
  git,
  prTitle,
  prNumber,
  status,
  place,
  selected,
  onSelect
}: JobCardProps): React.JSX.Element {
  const branch = git?.branch ?? cfg.branch
  const title = prTitle ?? readableBranch(branch) ?? (cfg.running ? 'No job yet' : 'Not started')
  const files = changedFiles(git)
  const meta = [
    prNumber ? `PR #${prNumber}` : null,
    files > 0 ? `${files} file${files === 1 ? '' : 's'} changed` : null,
    git && git.ahead > 0 ? `${git.ahead} to push` : null,
    cfg.running ? null : 'stopped'
  ].filter((m): m is string => m !== null)

  return (
    <button
      type="button"
      onClick={onSelect}
      className="chamfer-sm flex flex-col gap-1 px-2.5 py-2 text-left"
      style={{
        background: 'var(--surface2)',
        boxShadow: selected
          ? 'inset 0 0 0 1px var(--van-white)'
          : place === 1
            ? 'inset 0 0 0 1px var(--orange)'
            : 'inset 0 0 0 1px var(--border)'
      }}
      title={branch ?? undefined}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="truncate text-[0.8rem]"
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontWeight: 500,
            color: 'var(--van-white)'
          }}
        >
          {cfg.displayName}
        </span>
        {place !== null ? (
          <span
            className="chamfer-sm ml-auto px-1 font-mono text-[0.62rem]"
            style={
              place === 1
                ? { background: 'var(--orange)', color: 'var(--surface2)' }
                : { boxShadow: 'inset 0 0 0 1px var(--orange)', color: 'var(--orange)' }
            }
          >
            {place}
          </span>
        ) : WORKING.includes(status) ? (
          <span className="t-body-sm ml-auto text-dirty-grey">working</span>
        ) : null}
      </span>
      <span className="t-body-sm line-clamp-2 text-van-white">{title}</span>
      {meta.length > 0 ? (
        <span className="t-body-sm truncate text-dirty-grey">{meta.join(' · ')}</span>
      ) : null}
    </button>
  )
}
