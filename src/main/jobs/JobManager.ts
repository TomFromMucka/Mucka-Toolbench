import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentConfig,
  Job,
  JobBrief,
  JobId,
  JobPr,
  JobsAutoStatus,
  SentryIssue,
  Ticket
} from '@shared/types'
import { getValue, setValue } from '../db/kv'
import { logEvent } from '../events/Events'
import { sentryBrief } from './sentryBrief'
import { TICKET_JOB_DENY, ticketBrief } from './ticketBrief'
import {
  closeJob,
  getJob,
  getJobBrief,
  insertJob,
  listOpenJobs,
  terminalIdForJob,
  updateJob
} from '../db/jobs'

/** Claude Code files a folder's conversations under its path with every other character as `-`. */
function hasClaudeHistory(folder: string): boolean {
  const dir = join(homedir(), '.claude', 'projects', folder.replace(/[^A-Za-z0-9-]/g, '-'))
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl'))
  } catch {
    return false
  }
}

/**
 * What a job's terminal runs: Claude straight away, in Tom's normal mode,
 * then an ordinary login shell when he quits it. Null until the worktree
 * is ready.
 */
export function jobShell(
  id: JobId
): { command: string; args: string[]; cwd: string; env: Record<string, string> } | null {
  const job = getJob(id)
  if (!job || job.state !== 'ready') return null
  const shell = process.env.SHELL?.includes('zsh') ? process.env.SHELL : '/bin/zsh'
  const install = job.needsInstall ? 'npm ci && npm audit; ' : ''
  // After a cockpit restart the job's terminal comes back. Claude keeps
  // one history per folder and a job has its own folder, so `--continue`
  // always picks up this job's conversation rather than starting over.
  // A job from Intake opens with its brief as Claude's first message. It
  // goes in through the environment, so no quoting can mangle it, and it
  // is only used before the conversation exists.
  const resume = hasClaudeHistory(job.worktreePath)
  const brief = resume ? null : getJobBrief(id)
  const claude = resume ? 'claude --continue' : brief ? 'claude "$MUCKA_JOB_BRIEF"' : 'claude'
  return {
    command: shell,
    args: ['-l', '-i', '-c', `${install}${claude}; exec ${shell} -l`],
    cwd: job.worktreePath,
    env: brief ? { MUCKA_JOB_BRIEF: brief } : {}
  }
}

const execFileAsync = promisify(execFile)

/**
 * Creates jobs: each one a fresh git worktree off the latest main, ready
 * for its own Claude terminal.
 *
 * Fresh rather than a pool of parked worktrees (decided 2026-10-07):
 * measured on Tom's 64GB M5 Pro, cloning a matching node_modules with
 * APFS copy-on-write takes ~13s and costs almost no disk, so a clean
 * worktree per job is close to a parked one in speed, with no leftovers,
 * its own Claude history, and no six-job ceiling. Claude's auto-memory is
 * keyed by repo, not folder, so a new path loses nothing.
 */

/** Local files a worktree needs that git doesn't carry. */
const LOCAL_FILES = ['.env', '.env.local', 'CLAUDE.local.md']

/**
 * Run git and return stdout. On failure, throw with git's own last line
 * of stderr: Node's message is just "Command failed: <the command>",
 * which says nothing about why.
 */
async function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: timeoutMs })
    return stdout.trim()
  } catch (err) {
    const stderr =
      typeof err === 'object' && err !== null && 'stderr' in err && typeof err.stderr === 'string'
        ? err.stderr
        : ''
    const why = stderr
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .pop()
    throw new Error(`git ${args[0]}: ${why ?? (err instanceof Error ? err.message : String(err))}`)
  }
}

const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']

/**
 * Run the gh CLI, as Tom does in his terminals, and return stdout. The
 * cockpit's own GITHUB_TOKEN / GH_TOKEN are stripped first: gh prefers
 * them over its login, and the stored one can be stale (a 401 here is
 * how jobs lost sight of their PRs).
 */
async function gh(cwd: string, args: string[]): Promise<string> {
  const bin = GH_PATHS.find((p) => existsSync(p))
  if (!bin) throw new Error('the gh CLI is not installed (brew install gh, then gh auth login)')
  const env = { ...process.env }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  try {
    const { stdout } = await execFileAsync(bin, args, { cwd, env, timeout: 30_000 })
    return stdout.trim()
  } catch (err) {
    const stderr =
      typeof err === 'object' && err !== null && 'stderr' in err && typeof err.stderr === 'string'
        ? err.stderr.trim().split('\n').pop()
        : null
    throw new Error(
      `gh ${args[0]} ${args[1] ?? ''}: ${stderr || (err instanceof Error ? err.message : String(err))}`
    )
  }
}

/** The newest PR from a branch, in any state, via `gh pr list`. */
async function prForBranch(root: string, branch: string): Promise<JobPr | null> {
  const out = await gh(root, [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--limit',
    '1',
    '--json',
    'number,url,state,isDraft,autoMergeRequest'
  ])
  const parsed: unknown = JSON.parse(out || '[]')
  const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined
  if (typeof first !== 'object' || first === null) return null
  const num = 'number' in first && typeof first.number === 'number' ? first.number : null
  const url = 'url' in first && typeof first.url === 'string' ? first.url : null
  const raw = 'state' in first && typeof first.state === 'string' ? first.state : ''
  const draft = 'isDraft' in first && first.isDraft === true
  const auto = 'autoMergeRequest' in first && first.autoMergeRequest !== null
  if (num === null || url === null) return null
  const state = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : draft ? 'draft' : 'open'
  return { number: num, url, state, autoMerge: auto }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `2026-10-07 13:42` → `1007-1342`, unique among existing folders. */
function jobSlug(jobsDir: string, now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const base = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  let slug = base
  // The table too, not just the folder: the folder only appears once setup
  // gets going, so two jobs started in the same minute both saw it free.
  const taken = (s: string): boolean =>
    existsSync(join(jobsDir, `job-${s}`)) || getJob(`job-${s}`) !== null
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`
  return slug
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Where the hook records Tom's messages to each job's Claude. */
const PROMPTS_DIR = join(homedir(), '.claude', 'mucka-jobs')
const UNTITLED = 'New job'
const TITLE_MAX = 70

/** First line of Tom's first message, trimmed to fit a card. */
function titleFrom(prompt: string): string | null {
  const line = prompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('/'))
  if (!line) return null
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
}

/**
 * Sentry tickets start jobs by themselves, at most this many open at once.
 * Tom sees ~5 new issues a day; Mucka's triage passes the real ones on.
 * The cap is backpressure: a job counts until he's signed it off, so a
 * noisy day queues up rather than burying him.
 */
const AUTO_CAP = 3
const AUTO_KEY = 'jobs.autoSentry'
const QUEUE_KEY = 'jobs.autoSentryQueue'
const sentrySource = (issue: SentryIssue): string => `sentry:${issue.shortId}`

/** How often to look for removed folders, and (every fourth pass) PR changes. */
const SWEEP_MS = 15_000
const PR_EVERY = 4
/** A finished job leaves the board once its Claude stops, or after this at most. */
const FINISHED_GRACE_MS = 5 * 60_000

export interface JobManagerDeps {
  listAgents: () => AgentConfig[]
  emit: (jobs: Job[]) => void
  killTerminal: (terminalId: string) => void
  /** Ask Tom in a native dialog. Resolves true only on the confirm button. */
  confirm: (message: string, detail: string, confirmLabel: string) => Promise<boolean>
  getSentryIssue: (issueId: string) => Promise<SentryIssue | null>
}

export class JobManager {
  private readonly listAgents: () => AgentConfig[]
  private readonly emit: (jobs: Job[]) => void
  private readonly killTerminal: (terminalId: string) => void
  private readonly confirm: JobManagerDeps['confirm']
  private readonly getSentryIssue: JobManagerDeps['getSentryIssue']
  private promptWatcher: FSWatcher | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  private sweeps = 0
  private readonly leaving = new Map<JobId, NodeJS.Timeout>()
  /** Last PR-lookup failure reported, so a persistent one is said once, not every minute. */
  private prProblem: string | null = null

  constructor(deps: JobManagerDeps) {
    this.listAgents = deps.listAgents
    this.emit = deps.emit
    this.killTerminal = deps.killTerminal
    this.confirm = deps.confirm
    this.getSentryIssue = deps.getSentryIssue
    try {
      mkdirSync(PROMPTS_DIR, { recursive: true })
      this.promptWatcher = watch(PROMPTS_DIR, () => this.titleFromPrompts())
    } catch {
      this.promptWatcher = null
    }
    this.titleFromPrompts()
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS)
    void this.sweep()
  }

  private async sweep(): Promise<void> {
    this.noticeRemovedFolders()
    if (this.sweeps++ % PR_EVERY === 0) await this.refreshPrs()
  }

  /**
   * `/coach job-done` removes the job's folder and branch itself, from
   * inside the job's own Claude. That's the signal the job is done. One
   * last PR lookup records how it ended (a PR can open and merge between
   * two polls), then the card leaves the board once Claude has finished
   * its closing report.
   */
  private noticeRemovedFolders(): void {
    let changed = false
    for (const job of listOpenJobs()) {
      if (job.state === 'finished' && !this.leaving.has(job.id)) {
        // Left over from before a restart: nothing left to read.
        this.leaveSoon(job.id, 0)
        continue
      }
      if (job.state !== 'ready' || existsSync(job.worktreePath)) continue
      updateJob(job.id, { state: 'finished', detail: 'Finished. Folder and branch removed.' })
      this.leaveSoon(job.id, FINISHED_GRACE_MS)
      changed = true
    }
    if (changed) this.push()
  }

  private leaveSoon(id: JobId, afterMs: number): void {
    const existing = this.leaving.get(id)
    if (existing) clearTimeout(existing)
    this.leaving.set(
      id,
      setTimeout(() => {
        void this.refreshPrs(id).finally(() => this.close(id))
      }, afterMs)
    )
  }

  /**
   * A job's card can't show its PR, and metrics can't tell it merged,
   * while lookups fail. Say why on the job sheet, once per distinct reason.
   */
  private reportPrProblem(err: unknown): void {
    const why = err instanceof Error ? err.message : String(err)
    if (why === this.prProblem) return
    this.prProblem = why
    console.warn('[jobs] PR lookup failed:', why)
    logEvent({
      source: 'system',
      kind: 'jobs.pr_lookup_failed',
      message: `Jobs can't see their PRs on GitHub: ${why}`,
      tone: 'bad'
    })
  }

  /** A job's Claude has stopped. A finished job can go now. */
  onJobIdle(id: JobId): void {
    if (getJob(id)?.state === 'finished') this.leaveSoon(id, 3_000)
  }

  /** Look up each job's PR. Quietly skips when GitHub isn't set up. */
  async refreshPrs(only?: JobId): Promise<void> {
    // Finished jobs too: the branch is gone locally but GitHub still
    // knows its PR, and that's how the job ended.
    const jobs = listOpenJobs().filter(
      (j) =>
        (j.state === 'ready' || j.state === 'finished') && (only === undefined || j.id === only)
    )
    if (jobs.length === 0) return
    let root: string
    try {
      root = await this.repoRoot()
    } catch (err) {
      this.reportPrProblem(err)
      return
    }
    let changed = false
    for (const job of jobs) {
      let pr: JobPr | null
      try {
        pr = await prForBranch(root, job.branch)
      } catch (err) {
        this.reportPrProblem(err)
        return
      }
      this.prProblem = null
      if (JSON.stringify(pr) === JSON.stringify(job.pr)) continue
      updateJob(job.id, { pr })
      changed = true
    }
    if (changed) this.push()
  }

  /**
   * Name each untitled job after Tom's first message to its Claude, the
   * way he'd describe the job himself. A title he's given stays.
   */
  private titleFromPrompts(): void {
    let changed = false
    let files: string[]
    try {
      files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.json'))
    } catch {
      return
    }
    for (const job of listOpenJobs()) {
      if (job.title !== UNTITLED) continue
      const slug = job.id.replace(/[^A-Za-z0-9_-]/g, '_')
      if (!files.includes(`${slug}.json`)) continue
      let first: unknown
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(PROMPTS_DIR, `${slug}.json`), 'utf8'))
        first =
          typeof parsed === 'object' && parsed !== null && 'firstPrompt' in parsed
            ? parsed.firstPrompt
            : null
      } catch {
        continue
      }
      const title = typeof first === 'string' ? titleFrom(first) : null
      if (!title) continue
      updateJob(job.id, { title })
      changed = true
    }
    if (changed) this.push()
  }

  /** Start a job briefed with a Sentry issue, or return the one it already has. */
  async startFromSentry(issue: SentryIssue): Promise<Job> {
    const existing = listOpenJobs().find((j) => j.source === sentrySource(issue))
    if (existing) return existing
    this.setQueue(this.queue().filter((id) => id !== issue.id))
    return this.create({
      title: `${issue.shortId}: ${issue.title}`,
      prompt: sentryBrief(issue),
      source: sentrySource(issue)
    })
  }

  /** Start a job on a support ticket, or return the one it already has. */
  async startFromTicket(ticket: Pick<Ticket, 'reference' | 'subject'>): Promise<Job> {
    const source = `ticket:${ticket.reference}`
    const existing = listOpenJobs().find((j) => j.source === source)
    if (existing) return existing
    return this.create({
      title: `${ticket.reference}: ${ticket.subject}`,
      prompt: ticketBrief(ticket.reference),
      source
    })
  }

  async startSentryById(issueId: string): Promise<Job> {
    const issue = await this.getSentryIssue(issueId)
    if (!issue) throw new Error(`Sentry issue ${issueId} isn't in the latest list.`)
    return this.startFromSentry(issue)
  }

  autoStatus(): JobsAutoStatus {
    return {
      enabled: getValue(AUTO_KEY) !== 'off',
      cap: AUTO_CAP,
      open: this.openSentryJobs(),
      queued: this.queue()
    }
  }

  setAuto(enabled: boolean): JobsAutoStatus {
    setValue(AUTO_KEY, enabled ? 'on' : 'off')
    if (enabled) void this.drainQueue()
    this.push()
    return this.autoStatus()
  }

  /** Mucka ruled a Sentry issue worth fixing. Start on it, or queue it. */
  async onSentryTicket(issueId: string): Promise<void> {
    if (!this.autoStatus().enabled) return
    const issue = await this.getSentryIssue(issueId)
    if (!issue || listOpenJobs().some((j) => j.source === sentrySource(issue))) return
    if (this.openSentryJobs() >= AUTO_CAP) {
      if (!this.queue().includes(issueId)) this.setQueue([...this.queue(), issueId])
      this.push()
      return
    }
    await this.startFromSentry(issue).catch(() => undefined)
  }

  private async drainQueue(): Promise<void> {
    if (!this.autoStatus().enabled) return
    while (this.openSentryJobs() < AUTO_CAP) {
      const [next, ...rest] = this.queue()
      if (next === undefined) return
      this.setQueue(rest)
      await this.onSentryTicket(next)
    }
  }

  private openSentryJobs(): number {
    return listOpenJobs().filter((j) => j.source?.startsWith('sentry:')).length
  }

  private queue(): string[] {
    try {
      const parsed: unknown = JSON.parse(getValue(QUEUE_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }

  private setQueue(ids: string[]): void {
    setValue(QUEUE_KEY, JSON.stringify(ids))
  }

  dispose(): void {
    this.promptWatcher?.close()
    this.promptWatcher = null
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
    for (const timer of this.leaving.values()) clearTimeout(timer)
    this.leaving.clear()
  }

  list(): Job[] {
    return listOpenJobs()
  }

  /**
   * The repo jobs are cut from: the main checkout behind the agents'
   * worktrees. Jobs live next to it in `<repo>-jobs/`.
   */
  private async repoRoot(): Promise<string> {
    // MUCKA_JOBS_REPO names the repo outright, for a cockpit whose agents
    // aren't pointed at it yet (a fresh install, or the dev build's own
    // settings). Any checkout of the repo will do.
    const pinned = process.env.MUCKA_JOBS_REPO?.trim()
    const places = [...(pinned ? [pinned] : []), ...this.listAgents().map((a) => a.worktreePath)]
    for (const place of places) {
      if (!existsSync(place)) continue
      try {
        const common = await git(place, ['rev-parse', '--git-common-dir'])
        const root = dirname(resolve(place, common))
        if (existsSync(join(root, '.git'))) return root
      } catch {
        /* not a repo; try the next place */
      }
    }
    throw new Error(
      'No repo to start a job from: point an agent at a worktree in Settings, or set MUCKA_JOBS_REPO.'
    )
  }

  /**
   * Starts a job and returns it straight away in `setting-up`. The rest
   * runs in the background and pushes the job list as it goes, so the
   * card shows progress and the terminal opens the moment it's ready.
   */
  async create(brief?: JobBrief): Promise<Job> {
    const root = await this.repoRoot()
    const jobsDir = join(dirname(root), `${basename(root)}-jobs`)
    mkdirSync(jobsDir, { recursive: true })
    const slug = jobSlug(jobsDir, new Date())
    const id: JobId = `job-${slug}`
    const job: Job = {
      id,
      title: brief?.title ?? UNTITLED,
      branch: `job/${slug}`,
      worktreePath: join(jobsDir, id),
      terminalId: terminalIdForJob(id),
      state: 'setting-up',
      detail: 'Fetching the latest main…',
      needsInstall: false,
      pr: null,
      source: brief?.source ?? null,
      createdAt: Date.now()
    }
    insertJob(job, brief?.prompt ?? null)
    this.push()
    void this.setUp(job, root)
    return job
  }

  /**
   * Bring origin/main up to date. Best effort: every worktree of the repo
   * shares one git store, so a fetch running elsewhere at the same moment
   * (an agent, the git poller) can hold the ref lock. Retry briefly, and
   * if it still fails, say so and start from the main we last fetched.
   */
  private async fetchMain(root: string): Promise<string | null> {
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await git(root, ['fetch', 'origin', 'main'], 120_000)
        return null
      } catch (err) {
        last = err instanceof Error ? err.message : String(err)
        await sleep(1500)
      }
    }
    return last
  }

  private async setUp(job: Job, root: string): Promise<void> {
    try {
      const fetchProblem = await this.fetchMain(root)
      this.progress(job.id, 'Creating the worktree…')
      // A retry after a half-finished attempt may find the branch already made.
      const branchExists = await git(root, ['rev-parse', '--verify', '--quiet', job.branch])
        .then(() => true)
        .catch(() => false)
      await git(
        root,
        branchExists
          ? ['worktree', 'add', job.worktreePath, job.branch]
          : ['worktree', 'add', '-b', job.branch, job.worktreePath, 'origin/main']
      )
      const caveat = fetchProblem
        ? `Started from the last fetched main, because fetching failed (${fetchProblem})`
        : null

      this.progress(job.id, 'Copying local settings…')
      this.copyLocalFiles(root, job.worktreePath)
      if (job.source?.startsWith('ticket:')) {
        // Gitignored, and never copied from the main checkout, so this is
        // the job's whole local settings file.
        mkdirSync(join(job.worktreePath, '.claude'), { recursive: true })
        writeFileSync(
          join(job.worktreePath, '.claude', 'settings.local.json'),
          `${JSON.stringify({ permissions: { deny: TICKET_JOB_DENY } }, null, 2)}\n`
        )
      }

      const source = await this.matchingNodeModules(root, job.worktreePath)
      if (source) {
        this.progress(job.id, `Cloning dependencies from ${basename(dirname(source))}…`)
        // `cp -c` makes APFS clones: copy-on-write, so ~13s and next to no disk.
        await execFileAsync('cp', ['-Rc', source, join(job.worktreePath, 'node_modules')], {
          timeout: 300_000
        })
        updateJob(job.id, { state: 'ready', detail: caveat })
      } else {
        // No checkout has dependencies for this lockfile, so the terminal
        // installs them first, where Tom can see it.
        updateJob(job.id, { state: 'ready', detail: caveat, needsInstall: true })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
      updateJob(job.id, { state: 'failed', detail: `Setup failed: ${message}` })
    }
    this.push()
  }

  async retry(id: JobId): Promise<void> {
    const job = getJob(id)
    if (!job || job.state !== 'failed') return
    if (existsSync(job.worktreePath)) {
      updateJob(id, {
        detail: `Setup failed part-way and left ${job.worktreePath} behind. Remove that folder, then try again.`
      })
      this.push()
      return
    }
    updateJob(id, { state: 'setting-up', detail: 'Trying again…' })
    this.push()
    await this.setUp(job, await this.repoRoot())
  }

  /**
   * Take a failed job off the board. Only before it has a folder: once a
   * worktree exists, removing it deletes files, and that's sign-off's job,
   * with Tom's yes.
   */
  discard(id: JobId): void {
    const job = getJob(id)
    if (!job || job.state !== 'failed' || existsSync(job.worktreePath)) return
    closeJob(id)
    this.push()
  }

  /**
   * A checkout of the latest main that nothing edits, for the ticket scout
   * to read and to run `scripts/ticket.ts` from. `<repo>-jobs/scout`,
   * moved to origin/main on every call, with dependencies cloned from a
   * checkout installed from the same lockfile (never installed here).
   */
  /**
   * The scout checkout as it is, for quick reads: no fetch, no move. The
   * ticket poll keeps it on the latest main; only a missing one is set up.
   */
  async scoutDir(): Promise<string> {
    const root = await this.repoRoot()
    const dir = join(dirname(root), `${basename(root)}-jobs`, 'scout')
    if (existsSync(join(dir, 'node_modules', '.scout-lock'))) return dir
    return this.scoutCheckout()
  }

  async scoutCheckout(): Promise<string> {
    const root = await this.repoRoot()
    const dir = join(dirname(root), `${basename(root)}-jobs`, 'scout')
    const fetchProblem = await this.fetchMain(root)
    if (!existsSync(dir)) {
      mkdirSync(dirname(dir), { recursive: true })
      await git(root, ['worktree', 'add', '--detach', dir, 'origin/main'])
      this.copyLocalFiles(root, dir)
    } else {
      await git(dir, ['checkout', '--quiet', '--detach', 'origin/main'])
    }
    const lock = readIfExists(join(dir, 'package-lock.json'))
    const stamp = join(dir, 'node_modules', '.scout-lock')
    if (lock !== null && readIfExists(stamp) !== lock) {
      const source = await this.matchingNodeModules(root, dir)
      if (!source) {
        throw new Error(
          `no checkout has dependencies for main's lockfile yet${fetchProblem ? `, and ${fetchProblem}` : ''}`
        )
      }
      await execFileAsync('rm', ['-rf', join(dir, 'node_modules')])
      await execFileAsync('cp', ['-Rc', source, join(dir, 'node_modules')], { timeout: 300_000 })
      writeFileSync(stamp, lock)
    }
    return dir
  }

  /**
   * Throw a job away. The work may never have reached main, so this always
   * asks first, in a dialog that names what would be lost. On yes: stop
   * its terminal, close its PR (the branch stays on GitHub), then delete
   * its folder and local branch.
   */
  async dismiss(id: JobId): Promise<boolean> {
    const job = getJob(id)
    if (!job || job.state !== 'ready') return false
    const root = await this.repoRoot()
    const losses: string[] = []
    if (existsSync(job.worktreePath)) {
      const dirty = (await git(job.worktreePath, ['status', '--porcelain']).catch(() => ''))
        .split('\n')
        .filter((l) => l.trim().length > 0).length
      if (dirty > 0) losses.push(`${dirty} file${dirty === 1 ? '' : 's'} with uncommitted changes`)
      const unpushed = await git(job.worktreePath, ['rev-list', '--count', '@{upstream}..HEAD'])
        .catch(() => git(job.worktreePath, ['rev-list', '--count', 'origin/main..HEAD']))
        .then((n) => Number(n))
        .catch(() => 0)
      if (unpushed > 0) losses.push(`${unpushed} commit${unpushed === 1 ? '' : 's'} not on GitHub`)
    }
    const openPr = job.pr && (job.pr.state === 'open' || job.pr.state === 'draft') ? job.pr : null
    const detail = [
      `Deletes ${job.worktreePath} and the branch ${job.branch}.`,
      openPr ? `Closes PR #${openPr.number} without merging. Its branch stays on GitHub.` : null,
      losses.length > 0
        ? `Lost for good: ${losses.join(' and ')}.`
        : "Nothing is lost that isn't already on GitHub."
    ]
      .filter((l): l is string => l !== null)
      .join('\n\n')
    const yes = await this.confirm(`Throw away "${job.title}"?`, detail, 'Throw it away')
    if (!yes) return false

    this.killTerminal(job.terminalId)
    const problems: string[] = []
    if (openPr) {
      await gh(root, ['pr', 'close', String(openPr.number)]).catch((e: unknown) =>
        problems.push(e instanceof Error ? e.message : String(e))
      )
    }
    if (existsSync(job.worktreePath)) {
      await git(root, ['worktree', 'remove', '--force', job.worktreePath]).catch((e: unknown) =>
        problems.push(e instanceof Error ? e.message : String(e))
      )
    }
    await git(root, ['branch', '-D', job.branch]).catch(() => undefined)
    if (problems.length > 0) {
      updateJob(id, { detail: `Dismiss stopped part-way: ${problems[0]}` })
    } else {
      closeJob(id)
    }
    this.push()
    void this.drainQueue()
    return problems.length === 0
  }

  /** Take a finished job's card off the board. */
  close(id: JobId): void {
    const job = getJob(id)
    if (!job || job.state !== 'finished') return
    const timer = this.leaving.get(id)
    if (timer) clearTimeout(timer)
    this.leaving.delete(id)
    this.killTerminal(job.terminalId)
    closeJob(id)
    this.push()
    void this.drainQueue()
  }

  private progress(id: JobId, detail: string): void {
    updateJob(id, { detail })
    this.push()
  }

  /** Copy env files from the main checkout, else from any agent worktree that has them. */
  private copyLocalFiles(root: string, target: string): void {
    const sources = [root, ...this.listAgents().map((a) => a.worktreePath)]
    for (const file of LOCAL_FILES) {
      const from = sources.map((s) => join(s, file)).find((p) => existsSync(p))
      if (from) copyFileSync(from, join(target, file))
    }
  }

  /**
   * A node_modules installed from the same lockfile the new worktree has.
   * Any other would be the wrong versions, so none is better than a near
   * miss: the terminal then installs fresh.
   */
  private async matchingNodeModules(root: string, target: string): Promise<string | null> {
    const lock = readIfExists(join(target, 'package-lock.json'))
    if (!lock) return null
    // Every checkout of the repo, not just the agents' ones: a parked
    // worktree or an earlier job is as good a source as any.
    const listed = (await git(root, ['worktree', 'list', '--porcelain']))
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length))
    const candidates = [...new Set([root, ...listed])].filter((p) => p !== target)
    for (const dir of candidates) {
      if (!existsSync(join(dir, 'node_modules'))) continue
      if (readIfExists(join(dir, 'package-lock.json')) === lock) return join(dir, 'node_modules')
    }
    return null
  }

  private push(): void {
    this.emit(listOpenJobs())
  }
}
