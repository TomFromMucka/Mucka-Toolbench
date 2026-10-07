import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  AgentConfig,
  AgentId,
  PendingAnswer,
  PendingAnswerResult,
  PendingItem,
  PendingQuestion,
  TerminalId
} from '@shared/types'

/**
 * What each cockpit-launched Claude is waiting on Tom for, and the way to
 * answer it without touching the terminal.
 *
 * `scripts/claude-hooks/mucka-pending.sh` runs as Claude Code's
 * PermissionRequest hook. It writes one file per terminal describing the
 * prompt or question, then waits for `<terminal>.answer.json` and hands
 * that decision to Claude. The terminal keeps showing the dialog and still
 * takes a keypress while it waits, so an answer here and an answer typed
 * there race, and whichever lands first wins. A late answer from here is
 * refused as stale rather than sent.
 */

const DEFAULT_DIR = join(homedir(), '.claude', 'mucka-pending')

/** The hook stops waiting at 580s. Anything older is a Claude that died mid-wait. */
const MAX_AGE_MS = 600_000
const SWEEP_MS = 5_000

interface RawPending {
  id: string
  kind: 'permission' | 'question'
  agent: string | null
  terminal: string
  tool: string
  input: Record<string, unknown> | null
  /** Passed back verbatim as `updatedPermissions` for "don't ask again". */
  suggestions: unknown[]
  since: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Must match the `sed` in the hook script. */
function slugFor(terminalId: TerminalId): string {
  return terminalId.replace(/[^A-Za-z0-9_-]/g, '_')
}

function parseRaw(text: string): RawPending | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(v)) return null
  const id = str(v.id)
  const terminal = str(v.terminal)
  const tool = str(v.tool)
  if (!id || !terminal || !tool) return null
  return {
    id,
    kind: v.kind === 'question' ? 'question' : 'permission',
    agent: str(v.agent),
    terminal,
    tool,
    input: isRecord(v.input) ? v.input : null,
    suggestions: Array.isArray(v.suggestions) ? v.suggestions : [],
    since: typeof v.since === 'number' ? v.since : 0
  }
}

function firstLine(s: string, max = 200): string {
  const line =
    s
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function summarise(tool: string, input: Record<string, unknown> | null): string {
  if (!input) return tool
  const command = str(input.command)
  if (command) return firstLine(command)
  const path = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path)
  if (path) return `${tool} ${path}`
  const url = str(input.url)
  if (url) return `${tool} ${url}`
  const query = str(input.query) ?? str(input.pattern)
  if (query) return `${tool} "${firstLine(query, 120)}"`
  return tool
}

function ruleText(rule: unknown): string | null {
  if (!isRecord(rule)) return null
  const tool = str(rule.toolName)
  if (!tool) return null
  const content = str(rule.ruleContent)
  return content ? `${tool}(${content})` : tool
}

/**
 * Word the "don't ask again" button from what Claude would actually
 * remember. The suggestion differs case by case: a rule for a command, a
 * folder for the session, a permission mode.
 */
function alwaysLabel(suggestions: unknown[]): string | null {
  for (const s of suggestions) {
    if (!isRecord(s)) continue
    const forSession = s.destination === 'session'
    if (s.type === 'addRules' && Array.isArray(s.rules)) {
      const rules = s.rules.map(ruleText).filter((r): r is string => r !== null)
      if (rules.length > 0) return `Yes, and don't ask again for ${rules.join(', ')}`
    }
    if (s.type === 'addDirectories' && Array.isArray(s.directories)) {
      const dirs = s.directories.filter((d): d is string => typeof d === 'string')
      if (dirs.length > 0) {
        const names = dirs.map((d) => basename(d)).join(', ')
        return forSession
          ? `Yes, and allow ${names} for this session`
          : `Yes, and always allow ${names}`
      }
    }
    if (s.type === 'setMode' && s.mode === 'acceptEdits') {
      return forSession
        ? 'Yes, and accept edits for this session'
        : 'Yes, and accept edits from now on'
    }
  }
  return suggestions.length > 0 ? "Yes, and don't ask again" : null
}

function parseQuestions(input: Record<string, unknown> | null): PendingQuestion[] {
  if (!input || !Array.isArray(input.questions)) return []
  const out: PendingQuestion[] = []
  for (const q of input.questions) {
    if (!isRecord(q)) continue
    const question = str(q.question)
    if (!question || !Array.isArray(q.options)) continue
    const options = q.options
      .filter(isRecord)
      .map((o) => ({ label: str(o.label) ?? '', description: str(o.description) }))
      .filter((o) => o.label.length > 0)
    out.push({ question, header: str(q.header), options, multiSelect: q.multiSelect === true })
  }
  return out
}

function toItem(raw: RawPending, agentId: AgentId): PendingItem {
  const questions = raw.kind === 'question' ? parseQuestions(raw.input) : []
  return {
    id: raw.id,
    agentId,
    terminalId: raw.terminal,
    kind: raw.kind,
    tool: raw.tool,
    summary:
      raw.kind === 'question'
        ? (questions[0]?.question ?? raw.tool)
        : summarise(raw.tool, raw.input),
    alwaysLabel: raw.kind === 'permission' ? alwaysLabel(raw.suggestions) : null,
    questions,
    since: raw.since
  }
}

export class PendingWatcher {
  private readonly emit: (items: PendingItem[]) => void
  private readonly listAgents: () => AgentConfig[]
  private readonly isLiveTerminal: (terminalId: TerminalId) => boolean
  private readonly dir: string
  private watcher: FSWatcher | null = null
  private sweep: NodeJS.Timeout | null = null
  private items: PendingItem[] = []
  private lastKey = ''

  constructor(
    emit: (items: PendingItem[]) => void,
    listAgents: () => AgentConfig[],
    isLiveTerminal: (terminalId: TerminalId) => boolean,
    dir: string = DEFAULT_DIR
  ) {
    this.emit = emit
    this.listAgents = listAgents
    this.isLiveTerminal = isLiveTerminal
    this.dir = dir
  }

  start(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      /* unwritable home: nothing will ever be pending */
    }
    if (!existsSync(this.dir)) return
    try {
      this.watcher = watch(this.dir, () => this.refresh())
    } catch {
      this.watcher = null
    }
    // fs.watch can miss atomic renames on macOS, and age has to be
    // re-checked on a clock anyway.
    this.sweep = setInterval(() => this.refresh(), SWEEP_MS)
    this.refresh()
  }

  list(): PendingItem[] {
    return this.items
  }

  refresh(): void {
    let files: string[]
    try {
      files = readdirSync(this.dir).filter(
        (f) => f.endsWith('.json') && !f.endsWith('.answer.json')
      )
    } catch {
      return
    }
    const agents = this.listAgents()
    const now = Date.now()
    const next: PendingItem[] = []
    for (const file of files) {
      const raw = this.read(file)
      if (!raw || !raw.agent) continue
      // A file for a PTY that's gone, or one claiming an agent we don't
      // have, isn't anything Tom can answer.
      if (!this.isLiveTerminal(raw.terminal)) continue
      const agentId = agents.find((a) => a.id === raw.agent)?.id
      if (!agentId) continue
      if (now - raw.since > MAX_AGE_MS) continue
      next.push(toItem(raw, agentId))
    }
    next.sort((a, b) => a.since - b.since)
    const key = next.map((i) => i.id).join('|')
    this.items = next
    if (key === this.lastKey) return
    this.lastKey = key
    this.emit(next)
  }

  answer(answer: PendingAnswer): PendingAnswerResult {
    const slug = slugFor(answer.terminalId)
    // Re-read rather than trust the cached list: Tom may have answered in
    // the terminal a moment ago, and a decision for a prompt that's gone
    // must not be written.
    const raw = this.read(`${slug}.json`)
    if (!raw || raw.id !== answer.id || raw.terminal !== answer.terminalId) {
      this.refresh()
      return { ok: false, reason: 'stale' }
    }
    const decision = this.decisionFor(raw, answer)
    if (!decision) return { ok: false, reason: 'invalid' }

    const target = join(this.dir, `${slug}.answer.json`)
    const tmp = `${target}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ id: raw.id, decision }))
      renameSync(tmp, target)
    } catch {
      return { ok: false, reason: 'stale' }
    }
    return { ok: true }
  }

  private decisionFor(raw: RawPending, answer: PendingAnswer): Record<string, unknown> | null {
    if (answer.kind === 'permission') {
      if (raw.kind !== 'permission') return null
      if (answer.behavior === 'deny') {
        return { behavior: 'deny', message: 'Tom said no from the Toolbench cockpit.' }
      }
      return answer.always && raw.suggestions.length > 0
        ? { behavior: 'allow', updatedPermissions: raw.suggestions }
        : { behavior: 'allow' }
    }

    if (raw.kind !== 'question' || !raw.input) return null
    const questions = parseQuestions(raw.input)
    // Every question answered with one of its own options. Multi-select
    // isn't offered as buttons yet, so it never arrives here.
    for (const q of questions) {
      const chosen = answer.answers[q.question]
      if (q.multiSelect || !chosen || !q.options.some((o) => o.label === chosen)) return null
    }
    return { behavior: 'allow', updatedInput: { ...raw.input, answers: answer.answers } }
  }

  private read(file: string): RawPending | null {
    try {
      return parseRaw(readFileSync(join(this.dir, file), 'utf8'))
    } catch {
      return null
    }
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
    this.items = []
    this.lastKey = ''
  }
}
