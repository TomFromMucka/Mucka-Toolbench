import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { Agent, AgentConfig, AgentStatus, GitStatus, Job, PullRequest } from '@shared/types'
import { AgentClipboard } from '../components/AgentClipboard'
import { AgentTerminal } from '../components/AgentTerminal'
import { Button } from '../components/ui/Button'
import { Clipboard } from '../components/Clipboard'
import { IntakePanel } from '../components/IntakePanel'
import { WaitingStrip } from '../components/WaitingStrip'
import { useAgentSlots } from '../hooks/useAgentSlots'
import type { GitStatusMap } from '../hooks/useGitStatus'
import { useAgentStatuses } from '../state/AgentStatusContext'
import { useAgentsState } from '../state/AgentsContext'
import { useGitHubState } from '../state/GitHubContext'
import { useJobs } from '../state/JobsContext'
import { useFocusRequests, useNeedsYou } from '../state/NeedsYouContext'
import { submitPromptAndEnter } from '../mucka/dispatch'

/**
 * The Jobs layout's middle three columns: work coming in, the selected
 * job's terminal, and a board of the work in flight. The terminal is the
 * centre of the screen because it's where Tom spends his time, and the
 * queue of who's waiting on him sits right under its input (Tom's call,
 * 2026-10-08: the off-centre terminal had his neck turned all day).
 *
 * Two kinds of card share the board. A job (docs/jobs-layout-plan.md) is
 * started with "+ New job": its own fresh worktree and a terminal with
 * Claude already running. An agent is one of the fixed seats from the 4
 * and 6 layouts, shown here so nothing in flight disappears, titled by
 * its PR or branch and laned by Claude's reported status.
 */

type Lane = 'waiting' | 'working' | 'idle' | 'held'

// Waiting on you isn't a lane here: it's the strip under the terminal, and
// it holds finished work too (there's no separate Check it any more).
const LANES: { lane: Lane; title: string; empty: string }[] = [
  { lane: 'working', title: 'On the tools', empty: 'Nobody is working.' },
  { lane: 'idle', title: 'Idle', empty: 'Nothing idle.' },
  { lane: 'held', title: 'On hold', empty: 'Nothing on hold.' }
]

/** Mid-turn: typing into the terminal now would interrupt. */
const ACTIVE: AgentStatus[] = ['thinking', 'editing', 'running']
/** On the tools, including a Claude whose Monitor or background command is still going. */
const WORKING: AgentStatus[] = [...ACTIVE, 'background']

function workingTag(status: AgentStatus): string | null {
  if (status === 'background') return 'in background'
  return ACTIVE.includes(status) ? 'working' : null
}

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
  const { placeOf, queue } = useNeedsYou()
  // Only a real question or permission prompt holds the sign-off bar. A job
  // also queues once it has just gone quiet ("waiting for your input"), and
  // that's exactly when Job done is wanted.
  const askingNow = (id: string): boolean => queue.some((e) => e.key === id && e.pending !== null)
  const { statusFor } = useAgentStatuses()
  const { summaries } = useGitHubState()
  const slotFor = useAgentSlots(gitStatus, restartVersion)
  const { jobs, jobStatusFor, createJob } = useJobs()
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

  // Whatever's waiting on Tom (asking, or finished with work to look at)
  // is in the strip; NeedsYouContext decides that. The board has the rest.
  const laneOf = (cfg: AgentConfig): Lane => {
    // Parked by Tom until he releases it.
    if (cfg.held) return 'held'
    if (placeOf(cfg.id) !== null) return 'waiting'
    if (!cfg.running) return 'idle'
    return WORKING.includes(statusFor(cfg.id)) ? 'working' : 'idle'
  }

  const laneOfJob = (job: Job): Lane => {
    if (job.state === 'setting-up') return 'working'
    // On its way off the board: nothing left for Tom to look at.
    if (job.state === 'finished') return 'idle'
    if (job.held) return 'held'
    if (placeOf(job.id) !== null) return 'waiting'
    return WORKING.includes(jobStatusFor(job.id)) ? 'working' : 'idle'
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
      {/*
        Intake, not a Needs-you column: with many jobs running, a question
        needs the context its terminal gives (each option's explanation,
        typing an answer), and the Waiting lane, ⌘J and the banner already
        lead there. Tom's call, 2026-10-07.
      */}
      <IntakePanel onSelect={onSelect} />

      {/*
        Every agent's clipboard stays mounted, stacked in one cell, and only
        the selected one is visible. Switching jobs must not remount: a
        remount throws the xterm away (scrollback replay, "reconnected"
        banner, split tabs collapsing). `invisible` rather than `hidden`
        keeps each terminal its real size, so it doesn't refit to zero.
      */}
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <div className="grid min-h-0 min-w-0 flex-1">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={clsx(
                'col-start-1 row-start-1 grid min-h-0 min-w-0',
                job.id !== current && 'pointer-events-none invisible'
              )}
              aria-hidden={job.id !== current}
            >
              <JobTerminal
                job={job}
                blocked={askingNow(job.id)}
                working={ACTIVE.includes(jobStatusFor(job.id))}
              />
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
                <div className="flex min-h-0 min-w-0 flex-col">
                  <div className="grid min-h-0 flex-1">
                    <AgentClipboard
                      agent={slot.agent}
                      config={slot.config}
                      gitStatus={slot.gitStatus}
                      contextUsedPercent={slot.contextUsedPercent}
                      model={slot.model}
                    />
                  </div>
                  <AgentSignOffBar
                    cfg={cfg}
                    git={slot.gitStatus}
                    pr={summaries[cfg.id]?.openPr ?? null}
                    blocked={askingNow(cfg.id)}
                    working={ACTIVE.includes(statusFor(cfg.id))}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <WaitingStrip selected={current} onSelect={onSelect} />
      </div>

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
        <div className="grid h-full min-h-0 grid-cols-3 gap-2 overflow-y-auto p-2">
          {LANES.map(({ lane, title, empty }) => {
            const list = byLane.get(lane) ?? []
            return (
              <div key={lane} className="flex min-w-0 flex-col gap-1.5">
                <div
                  className="t-label-sm flex justify-between px-1 pb-1 text-dirty-grey"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <span>{title}</span>
                  <span>{list.length + jobsIn(lane).length}</span>
                </div>
                {jobsIn(lane).map((job) => (
                  <NewJobCard
                    key={job.id}
                    job={job}
                    place={placeOf(job.id)}
                    status={jobStatusFor(job.id)}
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
      className={clsx(
        'chamfer-frame-sm flex flex-col gap-1 px-2.5 py-2 text-left [--fill:var(--surface2)]',
        selected
          ? '[--ring:var(--van-white)]'
          : place === 1
            ? '[--ring:var(--orange)]'
            : '[--ring:var(--border)]'
      )}
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
            className={clsx(
              'ml-auto px-1 font-mono text-[0.62rem]',
              place === 1
                ? 'chamfer-sm'
                : 'chamfer-frame-sm [--fill:var(--surface2)] [--ring:var(--orange)]'
            )}
            style={
              place === 1
                ? { background: 'var(--orange)', color: 'var(--surface2)' }
                : { color: 'var(--orange)' }
            }
          >
            {place}
          </span>
        ) : cfg.held ? (
          <span className="t-body-sm ml-auto text-dirty-grey">on hold</span>
        ) : workingTag(status) ? (
          <span className="t-body-sm ml-auto text-dirty-grey">{workingTag(status)}</span>
        ) : null}
      </span>
      <span className="t-body-sm line-clamp-2 text-van-white">{title}</span>
      {meta.length > 0 ? (
        <span className="t-body-sm truncate text-dirty-grey">{meta.join(' · ')}</span>
      ) : null}
    </button>
  )
}

function prLine(job: Job): string | null {
  const pr = job.pr
  if (!pr) return null
  if (pr.state === 'merged') return `PR #${pr.number} merged`
  if (pr.state === 'closed') return `PR #${pr.number} closed`
  return `PR #${pr.number} · ${pr.autoMerge ? 'merges when checks pass' : 'open, auto-merge off'}`
}

function jobDetail(job: Job): string {
  if (job.state === 'failed') return job.detail ?? 'Setup failed.'
  if (job.state === 'setting-up') return job.detail ?? 'Setting up…'
  if (job.state === 'finished') return job.detail ?? 'Finished.'
  const pr = prLine(job)
  if (pr) return pr
  if (job.detail) return job.detail
  if (job.needsInstall) return 'Installing dependencies first'
  return job.branch
}

function NewJobCard({
  job,
  place,
  status,
  selected,
  onSelect
}: {
  job: Job
  place: number | null
  status: AgentStatus
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'chamfer-frame-sm flex flex-col gap-1 px-2.5 py-2 text-left [--fill:var(--surface2)]',
        selected ? '[--ring:var(--van-white)]' : '[--ring:var(--border)]'
      )}
      title={job.worktreePath}
    >
      <span className="flex items-center gap-1.5">
        <span className="t-label-sm text-dirty-grey">Job</span>
        {place !== null ? (
          <span
            className={clsx(
              'ml-auto px-1 font-mono text-[0.62rem]',
              place === 1
                ? 'chamfer-sm'
                : 'chamfer-frame-sm [--fill:var(--surface2)] [--ring:var(--orange)]'
            )}
            style={
              place === 1
                ? { background: 'var(--orange)', color: 'var(--surface2)' }
                : { color: 'var(--orange)' }
            }
          >
            {place}
          </span>
        ) : job.held ? (
          <span className="t-body-sm ml-auto text-dirty-grey">on hold</span>
        ) : workingTag(status) ? (
          <span className="t-body-sm ml-auto text-dirty-grey">{workingTag(status)}</span>
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

/**
 * Job done is an instruction to the job's own Claude, typed into its
 * terminal the way Tom would, so the wrap-up happens where he can watch it
 * and the skill's own checks apply. Shipping itself tends to happen in the
 * conversation, so this one button covers whatever's left: it stops on
 * loose ends, otherwise lands the PR and runs `/coach job-done` (Mucka
 * Pro's worktree-coach skill), which removes the folder once merged.
 */
const JOB_DONE_PROMPT = [
  'Wrap this job up.',
  'First check for loose ends: uncommitted work, failing tests or typecheck, anything I asked for that is not done, or an open question. If there are any, list them and stop.',
  "Otherwise, if there's no PR yet, commit, push and open one with /coach pr, and turn on auto-merge with `gh pr merge --squash --auto --delete-branch`.",
  'Wait for it to merge with `gh pr checks --watch --interval 60`, and never poll GitHub more often than once a minute: every job shares one GitHub allowance. If a check fails, read the failure and tell me rather than going on.',
  'Once it has merged, run /coach job-done.'
].join('\n')

/** A job's own terminal, with Claude started in its worktree, and its sign-off bar. */
function JobTerminal({
  job,
  blocked,
  working
}: {
  job: Job
  /** Its Claude is asking something, so typing would answer the question. */
  blocked: boolean
  working: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const act = (run: (id: string) => Promise<unknown>): void => {
    setBusy(true)
    void run(job.id).finally(() => setBusy(false))
  }
  const live = job.state === 'ready' || job.state === 'finished'
  return (
    <Clipboard title={job.title} subtitle={job.branch} bodyClassName="bg-surface-2 min-h-0">
      {live ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <AgentTerminal terminalId={job.terminalId} jobId={job.id} />
          </div>
          <SignOffBar job={job} blocked={blocked} working={working} />
        </div>
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

function SignOffBar({
  job,
  blocked,
  working
}: {
  job: Job
  blocked: boolean
  working: boolean
}): React.JSX.Element {
  const { focusTerminal } = useNeedsYou()
  const [busy, setBusy] = useState(false)

  if (job.state === 'finished') {
    return (
      <Bar note={job.detail ?? 'Finished.'}>
        <Button
          variant="primary"
          size="sm"
          trailingIcon={null}
          onClick={() => void window.mucka.closeJob(job.id)}
        >
          Close card
        </Button>
      </Bar>
    )
  }

  const notNow = blocked
    ? 'Answer its question first'
    : working
      ? 'Claude is working. Wait for it to stop.'
      : null
  const tell = (prompt: string): void => {
    focusTerminal(job.terminalId)
    void submitPromptAndEnter(job.terminalId, prompt)
  }
  const dismiss = (): void => {
    setBusy(true)
    void window.mucka.dismissJob(job.id).finally(() => setBusy(false))
  }
  const pr = job.pr
  const merged = pr?.state === 'merged'

  return (
    <Bar
      note={
        pr ? (
          <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
            {prLine(job)}
          </a>
        ) : (
          (notNow ?? 'When it’s finished: Job done checks for loose ends, lands it and tidies up.')
        )
      }
    >
      <Button
        variant="primary"
        size="sm"
        trailingIcon={null}
        disabled={notNow !== null}
        title={
          notNow ??
          'Claude checks for loose ends, opens the PR with auto-merge if needed, waits for the merge, then runs /coach job-done'
        }
        onClick={() => tell(JOB_DONE_PROMPT)}
      >
        Job done
      </Button>
      <Button
        variant="secondary"
        size="sm"
        trailingIcon={null}
        title="Put the cursor in the terminal to tell Claude what to change"
        onClick={() => focusTerminal(job.terminalId)}
      >
        Amend
      </Button>
      <Button
        variant="secondary"
        size="sm"
        trailingIcon={null}
        title={job.held ? 'Back to its lane' : 'Park it in On hold until something else lands'}
        onClick={() => void window.mucka.holdJob(job.id, !job.held)}
      >
        {job.held ? 'Release' : 'Hold'}
      </Button>
      {merged ? null : (
        <Button
          variant="tertiary"
          size="sm"
          trailingIcon={null}
          disabled={busy}
          title="Close its PR and delete its folder and branch. Asks first."
          onClick={dismiss}
        >
          Dismiss
        </Button>
      )}
    </Bar>
  )
}

/**
 * Finish is Job done for a fixed worktree: the same instruction typed into
 * its Claude, ending in `/coach finish` (park, prune, point the worktree at
 * a fresh main) rather than `/coach job-done`, because the folder is reused
 * for the next ticket. Pressing it is Tom's go-ahead to land the PR, so the
 * prompt says so: `/coach finish` would otherwise stop to offer the merge.
 */
const FINISH_PROMPT = [
  'Wrap this ticket up and finish the worktree.',
  'First check for loose ends: uncommitted work, failing tests or typecheck, anything I asked for that is not done, or an open question. If there are any, list them and stop.',
  "Otherwise, if there's no PR yet, commit, push and open one with /coach pr. Pressing Finish is my go-ahead to land it, so turn on auto-merge with `gh pr merge --squash --auto --delete-branch` without asking.",
  'Wait for it to merge with `gh pr checks --watch --interval 60`, and never poll GitHub more often than once a minute: every agent shares one GitHub allowance. If a check fails, read the failure and tell me rather than going on.',
  'Once it has merged, run /coach finish.'
].join('\n')

function AgentSignOffBar({
  cfg,
  git,
  pr,
  blocked,
  working
}: {
  cfg: AgentConfig
  git: GitStatus | undefined
  pr: PullRequest | null
  blocked: boolean
  working: boolean
}): React.JSX.Element {
  const { focusTerminal } = useNeedsYou()
  const { reload } = useAgentsState()
  const [busy, setBusy] = useState(false)

  const parked = readableBranch(git?.branch ?? cfg.branch) === null && changedFiles(git) === 0
  const notNow = blocked
    ? 'Answer its question first'
    : working
      ? 'Claude is working. Wait for it to stop.'
      : !cfg.running
        ? 'It isn’t running. Start it first.'
        : parked && !pr
          ? 'Nothing to finish: it’s on main or its slot.'
          : null
  const hold = (): void => {
    setBusy(true)
    void window.mucka
      .updateAgent({ id: cfg.id, held: !cfg.held })
      .then(() => reload())
      .finally(() => setBusy(false))
  }

  return (
    <Bar
      note={
        pr ? (
          <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
            PR #{pr.number} open
          </a>
        ) : (
          (notNow ??
          'When it’s finished: Finish checks for loose ends, lands it and parks the worktree.')
        )
      }
    >
      <Button
        variant="primary"
        size="sm"
        trailingIcon={null}
        disabled={notNow !== null}
        title={
          notNow ??
          'Claude checks for loose ends, opens the PR with auto-merge if needed, waits for the merge, then runs /coach finish'
        }
        onClick={() => {
          focusTerminal(cfg.id)
          void submitPromptAndEnter(cfg.id, FINISH_PROMPT)
        }}
      >
        Finish
      </Button>
      <Button
        variant="secondary"
        size="sm"
        trailingIcon={null}
        title="Put the cursor in the terminal to tell Claude what to change"
        onClick={() => focusTerminal(cfg.id)}
      >
        Amend
      </Button>
      <Button
        variant="secondary"
        size="sm"
        trailingIcon={null}
        disabled={busy}
        title={cfg.held ? 'Back to its lane' : 'Park it in On hold and out of Waiting on you'}
        onClick={hold}
      >
        {cfg.held ? 'Release' : 'Hold'}
      </Button>
    </Bar>
  )
}

function Bar({
  note,
  children
}: {
  note: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-3 py-2"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <span className="t-body-sm min-w-0 flex-1 truncate text-dirty-grey">{note}</span>
      {children}
    </div>
  )
}
