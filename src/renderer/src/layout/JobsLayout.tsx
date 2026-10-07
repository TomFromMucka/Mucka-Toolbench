import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { Agent, AgentConfig, AgentStatus, GitStatus, Job } from '@shared/types'
import { AgentClipboard } from '../components/AgentClipboard'
import { AgentTerminal } from '../components/AgentTerminal'
import { Button } from '../components/ui/Button'
import { Clipboard } from '../components/Clipboard'
import { NeedsYouCard } from '../components/NeedsYouCard'
import { useAgentSlots } from '../hooks/useAgentSlots'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useAgentStatuses } from '../state/AgentStatusContext'
import { useGitHubState } from '../state/GitHubContext'
import { useJobs } from '../state/JobsContext'
import { useFocusRequests, useNeedsYou } from '../state/NeedsYouContext'

/**
 * The Jobs layout's middle three columns: who needs Tom, a board of the
 * work in flight, and the selected job's terminal.
 *
 * Two kinds of card share the board. A job (docs/jobs-layout-plan.md) is
 * started with "+ New job": its own fresh worktree and a terminal with
 * Claude already running. An agent is one of the fixed seats from the 4
 * and 6 layouts, shown here so nothing in flight disappears, titled by
 * its PR or branch and laned by Claude's reported status.
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
  /** An agent id or a job id. */
  selected: string | null
  onSelect: (id: string) => void
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
  const { jobs, jobStatusFor, createJob } = useJobs()
  const [now, setNow] = useState(() => Date.now())
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const newJob = useCallback(async (): Promise<void> => {
    setStarting(true)
    setStartError(null)
    try {
      const job = await createJob()
      onSelect(job.id)
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [createJob, onSelect])

  // ⌘N from the workstation.
  useEffect(() => {
    const onNew = (): void => void newJob()
    window.addEventListener('mucka:new-job', onNew)
    return () => window.removeEventListener('mucka:new-job', onNew)
  }, [newJob])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // ⌘J and "Open terminal" name a terminal; in this layout that also means
  // "make that agent the job on screen". Split tabs are `<agent>:t<n>`.
  useFocusRequests(
    useCallback(
      (terminalId: string) => {
        const job = jobs.find((j) => j.terminalId === terminalId)
        if (job) {
          onSelect(job.id)
          return
        }
        const agentId = agents.find((a) => a.id === terminalId.split(':')[0])?.id
        if (agentId) onSelect(agentId)
      },
      [agents, jobs, onSelect]
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

  // A job is laned like an agent, from what its Claude reports. It counts
  // as finished ("Check it") once Tom has given it something to do and
  // it's gone quiet; a job nobody has spoken to yet is just idle.
  const laneOfJob = (job: Job): Lane => {
    if (job.state === 'setting-up') return 'working'
    if (job.state === 'failed') return 'check'
    if (placeOf(job.id) !== null) return 'waiting'
    if (WORKING.includes(jobStatusFor(job.id))) return 'working'
    return job.title === 'New job' ? 'idle' : 'check'
  }
  const jobsIn = (lane: Lane): Job[] =>
    jobs
      .filter((j) => laneOfJob(j) === lane)
      .sort((a, b) => (placeOf(a.id) ?? 0) - (placeOf(b.id) ?? 0))

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
                key={entry.pending?.id ?? entry.key}
                entry={entry}
                place={i + 1}
                now={now}
              />
            ))
          )}
        </div>
      </Clipboard>

      <Clipboard
        title="Job board"
        subtitle={startError ?? 'what everyone is on'}
        bodyClassName="min-h-0"
        rightSlot={
          <Button
            variant="primary"
            size="sm"
            trailingIcon={null}
            disabled={starting}
            onClick={() => void newJob()}
            title="A fresh worktree off the latest main, with Claude ready in its terminal (⌘N)"
          >
            {starting ? 'Starting…' : '+ New job'}
          </Button>
        }
      >
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
                {jobsIn(lane).map((job) => (
                  <NewJobCard
                    key={job.id}
                    job={job}
                    place={placeOf(job.id)}
                    working={WORKING.includes(jobStatusFor(job.id))}
                    selected={job.id === current}
                    onSelect={() => onSelect(job.id)}
                  />
                ))}
                {list.length === 0 && jobsIn(lane).length === 0 ? (
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
        {jobs.map((job) => (
          <div
            key={job.id}
            className={clsx(
              'col-start-1 row-start-1 grid min-h-0 min-w-0',
              job.id !== current && 'pointer-events-none invisible'
            )}
            aria-hidden={job.id !== current}
          >
            <JobTerminal job={job} />
          </div>
        ))}
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

function jobDetail(job: Job): string {
  if (job.state === 'failed') return job.detail ?? 'Setup failed.'
  if (job.state === 'setting-up') return job.detail ?? 'Setting up…'
  if (job.detail) return job.detail
  if (job.needsInstall) return 'Installing dependencies first'
  return job.branch
}

function NewJobCard({
  job,
  place,
  working,
  selected,
  onSelect
}: {
  job: Job
  place: number | null
  working: boolean
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="chamfer-sm flex flex-col gap-1 px-2.5 py-2 text-left"
      style={{
        background: 'var(--surface2)',
        boxShadow: selected ? 'inset 0 0 0 1px var(--van-white)' : 'inset 0 0 0 1px var(--border)'
      }}
      title={job.worktreePath}
    >
      <span className="flex items-center gap-1.5">
        <span className="t-label-sm text-dirty-grey">Job</span>
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
        ) : working ? (
          <span className="t-body-sm ml-auto text-dirty-grey">working</span>
        ) : null}
      </span>
      <span className="t-body-sm line-clamp-2 text-van-white">{job.title}</span>
      <span
        className={clsx(
          't-body-sm truncate',
          job.state === 'failed' ? 'text-status-bad' : 'text-dirty-grey'
        )}
      >
        {jobDetail(job)}
      </span>
    </button>
  )
}

/** A job's own terminal, with Claude started in its worktree. */
function JobTerminal({ job }: { job: Job }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const act = (run: (id: string) => Promise<void>): void => {
    setBusy(true)
    void run(job.id).finally(() => setBusy(false))
  }
  return (
    <Clipboard title={job.title} subtitle={job.branch} bodyClassName="bg-surface-2 min-h-0">
      {job.state === 'ready' ? (
        <AgentTerminal terminalId={job.terminalId} jobId={job.id} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
          <span
            className={clsx(
              't-body-md max-w-[40rem] text-center',
              job.state === 'failed' ? 'text-status-bad' : 'text-dirty-grey'
            )}
          >
            {jobDetail(job)}
          </span>
          {job.state === 'failed' ? (
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                trailingIcon={null}
                disabled={busy}
                onClick={() => act((id) => window.mucka.retryJob(id))}
              >
                Try again
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                trailingIcon={null}
                disabled={busy}
                onClick={() => act((id) => window.mucka.discardJob(id))}
              >
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Clipboard>
  )
}
