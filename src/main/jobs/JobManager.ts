import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig, Job, JobId } from '@shared/types'
import { closeJob, getJob, insertJob, listOpenJobs, terminalIdForJob, updateJob } from '../db/jobs'

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
export function jobShell(id: JobId): { command: string; args: string[]; cwd: string } | null {
  const job = getJob(id)
  if (!job || job.state !== 'ready') return null
  const shell = process.env.SHELL?.includes('zsh') ? process.env.SHELL : '/bin/zsh'
  const install = job.needsInstall ? 'npm ci && npm audit; ' : ''
  // After a cockpit restart the job's terminal comes back. Claude keeps
  // one history per folder and a job has its own folder, so `--continue`
  // always picks up this job's conversation rather than starting over.
  const claude = hasClaudeHistory(job.worktreePath) ? 'claude --continue' : 'claude'
  return {
    command: shell,
    args: ['-l', '-i', '-c', `${install}${claude}; exec ${shell} -l`],
    cwd: job.worktreePath
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `2026-10-07 13:42` → `1007-1342`, unique among existing folders. */
function jobSlug(jobsDir: string, now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const base = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  let slug = base
  for (let n = 2; existsSync(join(jobsDir, `job-${slug}`)); n++) slug = `${base}-${n}`
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

export class JobManager {
  private readonly listAgents: () => AgentConfig[]
  private readonly emit: (jobs: Job[]) => void
  private promptWatcher: FSWatcher | null = null

  constructor(listAgents: () => AgentConfig[], emit: (jobs: Job[]) => void) {
    this.listAgents = listAgents
    this.emit = emit
    try {
      mkdirSync(PROMPTS_DIR, { recursive: true })
      this.promptWatcher = watch(PROMPTS_DIR, () => this.titleFromPrompts())
    } catch {
      this.promptWatcher = null
    }
    this.titleFromPrompts()
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

  dispose(): void {
    this.promptWatcher?.close()
    this.promptWatcher = null
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
  async create(): Promise<Job> {
    const root = await this.repoRoot()
    const jobsDir = join(dirname(root), `${basename(root)}-jobs`)
    mkdirSync(jobsDir, { recursive: true })
    const slug = jobSlug(jobsDir, new Date())
    const id: JobId = `job-${slug}`
    const job: Job = {
      id,
      title: UNTITLED,
      branch: `job/${slug}`,
      worktreePath: join(jobsDir, id),
      terminalId: terminalIdForJob(id),
      state: 'setting-up',
      detail: 'Fetching the latest main…',
      needsInstall: false,
      createdAt: Date.now()
    }
    insertJob(job)
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
