import { execFile } from 'node:child_process'
import { promises as fs, type Dirent } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { WorktreeDiffScope, WorktreeReadResult } from '@shared/types'

/**
 * Read-only views of an agent's worktree for Mucka: a file, a directory,
 * a diff, a log. Everything is anchored to the worktree root — a path
 * that resolves outside it (including via symlink) is refused, since the
 * model asking for it may be acting on text it read rather than on Tom.
 * Output is pre-formatted and capped, because it goes straight into a
 * prompt.
 */

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 8_000
const FILE_CHAR_CAP = 32_000
const FILE_LINES_DEFAULT = 400
const FILE_LINES_MAX = 2_000
const DIFF_CHAR_CAP = 40_000
const DIR_ENTRY_CAP = 300
const LOG_LIMIT_MAX = 100

/**
 * Files that hold credentials even inside a worktree. Mucka never needs
 * them, and a model acting on injected text must not be able to lift them
 * into a card, a memory, or a reply.
 */
function isSecretFile(path: string): boolean {
  const name = basename(path)
  if (/\.(example|sample|template)$/.test(name)) return false
  if (/^\.env(\..+)?$/.test(name)) return true
  if (name === '.npmrc' || name === '.netrc' || name === 'secrets.enc.json') return true
  if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(name)) return true
  const ext = extname(name).toLowerCase()
  return ext === '.pem' || ext === '.key' || ext === '.p12' || ext === '.pfx'
}

function fail(reason: string): WorktreeReadResult {
  return { ok: false, reason }
}

function ok(text: string, note: string | null = null): WorktreeReadResult {
  return { ok: true, text, note }
}

/**
 * Resolve `rel` against the worktree and prove the result stays inside it.
 * Symlinks are followed on the nearest existing ancestor so a link out of
 * the tree can't smuggle a read past the prefix check.
 */
async function resolveInside(worktree: string, rel: string): Promise<string | null> {
  const root = await fs.realpath(resolve(worktree)).catch(() => null)
  if (!root) return null
  const target = resolve(root, rel.trim() || '.')
  let probe = target
  for (;;) {
    try {
      const real = await fs.realpath(probe)
      const rest = relative(probe, target)
      const resolved = rest ? resolve(real, rest) : real
      if (resolved === root || resolved.startsWith(root + sep)) return resolved
      return null
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return null
      probe = parent
    }
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024
  })
  return stdout
}

function capText(text: string, cap: number, what: string): { text: string; note: string | null } {
  if (text.length <= cap) return { text, note: null }
  return {
    text: text.slice(0, cap),
    note: `${what} truncated at ${cap.toLocaleString()} chars — ask for a narrower slice.`
  }
}

export async function readWorktreeFile(
  worktree: string,
  rel: string,
  startLine = 1,
  maxLines = FILE_LINES_DEFAULT
): Promise<WorktreeReadResult> {
  const path = await resolveInside(worktree, rel)
  if (!path) return fail(`"${rel}" is outside the worktree — only paths inside it can be read.`)
  if (isSecretFile(path)) return fail(`"${rel}" holds credentials — not readable from here.`)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(path)
  } catch {
    return fail(`No file at "${rel}".`)
  }
  if (stat.isDirectory()) return fail(`"${rel}" is a directory — use list_dir.`)
  if (!stat.isFile()) return fail(`"${rel}" is not a regular file.`)
  if (stat.size > 4 * 1024 * 1024) {
    return fail(`"${rel}" is ${stat.size} bytes — too large to read here.`)
  }
  const buf = await fs.readFile(path)
  const sniff = Math.min(buf.length, 8 * 1024)
  for (let i = 0; i < sniff; i++) {
    if (buf[i] === 0) return fail(`"${rel}" looks binary.`)
  }
  const lines = buf.toString('utf8').split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const from = Math.max(1, Math.floor(startLine))
  const count = Math.max(1, Math.min(FILE_LINES_MAX, Math.floor(maxLines)))
  const slice = lines.slice(from - 1, from - 1 + count)
  if (slice.length === 0) {
    return fail(`"${rel}" has ${lines.length} lines; start_line ${from} is past the end.`)
  }
  const width = String(from + slice.length - 1).length
  const body = slice.map((l, i) => `${String(from + i).padStart(width)}│${l}`).join('\n')
  const capped = capText(body, FILE_CHAR_CAP, 'File')
  const end = from + slice.length - 1
  const range = `${rel} — lines ${from}-${end} of ${lines.length}`
  const more =
    end < lines.length
      ? ` (${lines.length - end} more after this; pass start_line ${end + 1})`
      : ''
  return ok(`${range}${more}\n${capped.text}`, capped.note)
}

export async function listWorktreeDir(worktree: string, rel: string): Promise<WorktreeReadResult> {
  const path = await resolveInside(worktree, rel)
  if (!path) return fail(`"${rel}" is outside the worktree.`)
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(path, { withFileTypes: true })
  } catch {
    return fail(`No directory at "${rel || '.'}".`)
  }
  const entries = dirents
    .filter((d) => d.name !== '.git')
    .map((d) => ({ name: d.name, dir: d.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  const shown = entries.slice(0, DIR_ENTRY_CAP)
  const body = shown.map((e) => (e.dir ? `${e.name}/` : e.name)).join('\n')
  const note =
    entries.length > shown.length ? `${entries.length - shown.length} more entries not shown.` : null
  return ok(`${rel || '.'} — ${entries.length} entries\n${body || '(empty)'}`, note)
}

async function baseRef(cwd: string): Promise<string | null> {
  for (const candidate of ['main', 'master']) {
    try {
      await git(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`)
      return candidate
    } catch {
      /* try next */
    }
  }
  try {
    const ref = (await git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).trim()
    return ref || null
  } catch {
    return null
  }
}

export async function readWorktreeDiff(
  worktree: string,
  scope: WorktreeDiffScope,
  rel: string | null
): Promise<WorktreeReadResult> {
  const root = await resolveInside(worktree, '.')
  if (!root) return fail('Worktree path does not exist.')
  let pathArg: string[] = []
  if (rel && rel.trim()) {
    const inside = await resolveInside(worktree, rel)
    if (!inside) return fail(`"${rel}" is outside the worktree.`)
    pathArg = ['--', relative(root, inside) || '.']
  }
  let args: string[]
  let label: string
  if (scope === 'staged') {
    args = ['diff', '--cached']
    label = 'staged changes'
  } else if (scope === 'branch') {
    const base = await baseRef(root)
    if (!base) return fail('Could not find a main/master branch to diff against.')
    args = ['diff', `${base}...HEAD`]
    label = `branch vs ${base}`
  } else {
    args = ['diff', 'HEAD']
    label = 'uncommitted changes (staged + unstaged)'
  }
  try {
    const [stat, diff] = await Promise.all([
      git(root, ...args, '--stat', ...pathArg),
      git(root, ...args, ...pathArg)
    ])
    if (!diff.trim()) return ok(`No ${label}${rel ? ` under ${rel}` : ''}.`)
    const capped = capText(diff, DIFF_CHAR_CAP, 'Diff')
    return ok(`${label}\n${stat.trimEnd()}\n\n${capped.text}`, capped.note)
  } catch (err) {
    return fail(`git diff failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function readWorktreeLog(
  worktree: string,
  limit: number,
  branchOnly: boolean
): Promise<WorktreeReadResult> {
  const root = await resolveInside(worktree, '.')
  if (!root) return fail('Worktree path does not exist.')
  const n = Math.max(1, Math.min(LOG_LIMIT_MAX, Math.floor(limit)))
  const args = ['log', `-n${n}`, '--date=short', '--format=%h %ad %an — %s']
  let label = `last ${n} commits`
  if (branchOnly) {
    const base = await baseRef(root)
    if (!base) return fail('Could not find a main/master branch to compare against.')
    args.push(`${base}..HEAD`)
    label = `commits on this branch not on ${base}`
  }
  try {
    const out = (await git(root, ...args)).trimEnd()
    return ok(out ? `${label}\n${out}` : `No ${label}.`)
  } catch (err) {
    return fail(`git log failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
