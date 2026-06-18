import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  MuckaTextMessage,
  MuckaTextSegment,
  MuckaTextStatus,
  MuckaTextStreamEvent,
  MuckaTextToolCall,
  MuckaTextToolResult
} from '@shared/types'
import { TOOL_DEFINITIONS } from '@shared/mucka-tools'
import { appendChat, clearChat, listChat, listChatSince, searchChat } from '../db/chat'
import { listAgents } from '../db/agents'
import { listEvents } from '../events/Events'
import { getValue, setValue } from '../db/kv'
import {
  insertSummary,
  lastSummarizedTs,
  listRecentSummaries,
  searchSummaries
} from '../db/summaries'
import { buildMuckaMcpServer } from './agentTools'

/**
 * Persisted SDK session id. Resuming it on boot makes Mucka continue the
 * actual prior conversation with full (auto-compacted) native context,
 * instead of starting cold every launch.
 */
const SESSION_KEY = 'mucka.text.sessionId'
let currentSessionId: string | null = null

/** Roll a durable summary once this many un-summarized messages pile up. */
const SUMMARY_THRESHOLD = 40
let summarizing = false

/**
 * Text-mode Mucka backed by the Claude Agent SDK — uses Tom's Claude
 * Code subscription auth instead of a direct Anthropic API key.
 *
 * Slice 1 wires streaming + history persistence only — tools land in
 * slice 2. The voice-side path (ElevenLabs Conv AI) is untouched.
 */

const MODEL = process.env.MUCKA_TEXT_MODEL?.trim() || undefined
const PROMPT_FALLBACK =
  'You are Mucka, a terse British PM for the dev cockpit.'
const TOOL_CALL_TIMEOUT_MS = 60_000

let webContents: WebContents | null = null
let promptCache: string | null = null
let inFlight = false
let hasPriorTurnThisBoot = false

interface PendingCall {
  resolve: (result: MuckaTextToolResult) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}
const pendingCalls = new Map<string, PendingCall>()
let callCounter = 0

const mcpServer = buildMuckaMcpServer({
  dispatch: (name, params) => dispatchTool(name, params)
})

/**
 * Every cockpit tool is exposed through the in-process `mucka` MCP
 * server, so the SDK names them `mcp__mucka__<tool>`. We auto-allow
 * exactly these — there is no interactive permission UI in the banner
 * chat, so without this the SDK stalls every call with "you haven't
 * granted it yet". Confirm-gated writes are still gated downstream by the
 * renderer's ConfirmStrip; this only lifts the SDK-level block.
 */
const ALLOWED_MUCKA_TOOLS = TOOL_DEFINITIONS.map((d) => `mcp__mucka__${d.name}`)

function dispatchTool(
  name: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; result: string }> {
  callCounter += 1
  const callId = `a${Date.now().toString(36)}${callCounter}`
  return new Promise<MuckaTextToolResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      reject(new Error(`tool ${name} timed out after ${TOOL_CALL_TIMEOUT_MS}ms`))
    }, TOOL_CALL_TIMEOUT_MS)
    pendingCalls.set(callId, { resolve, reject, timer })
    emitToolCall({ callId, name, params })
  }).then(
    (r) => ({ ok: r.ok, result: r.result }),
    (err) => ({ ok: false, result: err instanceof Error ? err.message : String(err) })
  )
}

export function bindMuckaTextBroadcaster(wc: WebContents): void {
  webContents = wc
}

export function unbindMuckaTextBroadcaster(): void {
  webContents = null
}

export function getStatus(): MuckaTextStatus {
  // The SDK auths through Claude Code's CLI; if the CLI binary isn't on
  // PATH, query() will throw at runtime. Treat as ok here and let
  // sendMessage surface the failure inline.
  return { kind: 'ok' }
}

export function listHistory(): MuckaTextMessage[] {
  return listChat()
}

function formatWhen(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * Keyword recall across past conversation — the rolling transcript plus
 * older session summaries. Returns a compact, dated digest for Mucka to
 * read back from.
 */
export function searchHistory(queryStr: string, limit = 20): string {
  const q = queryStr.trim()
  if (!q) return 'Give me something to search for.'
  const summaries = searchSummaries(q, 5).map(
    (s) => `[${formatWhen(s.periodStart)}–${formatWhen(s.periodEnd)}] summary: ${s.summary}`
  )
  const hits = searchChat(q, limit).map((h) => {
    const who = h.role === 'user' ? 'Tom' : 'Mucka'
    const text = h.text.length > 280 ? h.text.slice(0, 280) + '…' : h.text
    return `[${formatWhen(h.ts)}] ${who}: ${text}`
  })
  const parts: string[] = []
  if (summaries.length > 0) parts.push('Older summaries:\n' + summaries.join('\n'))
  if (hits.length > 0) parts.push('Recent messages:\n' + hits.join('\n'))
  return parts.length > 0 ? parts.join('\n\n') : `Nothing in memory mentions "${q}".`
}

export function clearHistory(): void {
  clearChat()
  // After a wipe, forget the SDK session too — otherwise the next turn
  // would resume and revive the conversation Tom just cleared.
  hasPriorTurnThisBoot = false
  currentSessionId = null
  setValue(SESSION_KEY, '')
}

const VOICE_DEDUPE_MS = 4_000
let lastVoiceKey: { role: string; text: string; ts: number } | null = null

export function appendVoiceMessage(
  role: 'user' | 'assistant',
  text: string,
  ts?: number
): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const now = ts ?? Date.now()
  if (
    lastVoiceKey &&
    lastVoiceKey.role === role &&
    lastVoiceKey.text === trimmed &&
    now - lastVoiceKey.ts < VOICE_DEDUPE_MS
  ) {
    return
  }
  lastVoiceKey = { role, text: trimmed, ts: now }
  const msg = appendChat(
    role,
    [{ kind: 'text', text: trimmed, source: 'voice' }],
    now
  )
  emitMessage(msg)
}

let claudeBinaryCache: string | null | undefined

/**
 * In packaged builds the SDK resolves its native `claude` binary via
 * createRequire(import.meta.url) — which lands on the path INSIDE
 * app.asar. Electron's patched fs makes that path look real, but
 * child_process.spawn can't traverse an asar (it's a file, not a
 * directory) → `spawn ENOTDIR`. Point the SDK at the app.asar.unpacked
 * copy instead. In dev (no asar) the SDK's own resolution works.
 */
function packagedClaudeBinary(): string | null {
  if (claudeBinaryCache !== undefined) return claudeBinaryCache
  if (!app.isPackaged) {
    claudeBinaryCache = null
    return claudeBinaryCache
  }
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidate = join(
    app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'),
    'node_modules',
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
    binary
  )
  claudeBinaryCache = existsSync(candidate) ? candidate : null
  return claudeBinaryCache
}

/**
 * A compact, tool-free snapshot injected into the first message of each
 * boot so Mucka has grounding even before she calls anything — and a
 * fallback if a tool ever fails mid-session. Pulled straight from
 * main-process state: the agent lineup + the recent job-sheet feed.
 */
function buildBootSnapshot(): string {
  const lines: string[] = [
    '[cockpit snapshot — auto-injected context, not a tool result]'
  ]
  const agents = listAgents()
  if (agents.length > 0) {
    lines.push('Agents:')
    for (const a of agents) {
      const flags = [a.running ? 'running' : 'idle', a.needsAttention ? 'NEEDS ATTENTION' : null]
        .filter(Boolean)
        .join(', ')
      lines.push(`- ${a.id} ("${a.displayName}") — branch ${a.branch} — ${flags}`)
    }
  }
  const events = listEvents(10)
  if (events.length > 0) {
    lines.push('Recent events (newest first):')
    for (const e of events) {
      lines.push(`- [${e.source}] ${e.message}`)
    }
  }
  const summaries = listRecentSummaries(2)
  if (summaries.length > 0) {
    lines.push('Earlier context (summaries of past sessions):')
    for (const s of summaries) {
      lines.push(`- ${s.summary.replace(/\s*\n\s*/g, ' ')}`)
    }
  }
  return lines.join('\n')
}

function loadPrompt(): string {
  if (promptCache !== null) return promptCache
  // Operator override first — `~/.mucka-toolbench/prompts/pm.md` lets the
  // operator personalise Mucka's voice without forking the repo. Falls
  // through to the shipped generic prompt when absent.
  const candidates = [
    join(app.getPath('home'), '.mucka-toolbench/prompts/pm.md'),
    join(__dirname, '../../src/main/mucka/prompts/pm.md'),
    join(__dirname, 'mucka/prompts/pm.md')
  ]
  for (const path of candidates) {
    try {
      promptCache = readFileSync(path, 'utf8')
      return promptCache
    } catch {
      /* try next */
    }
  }
  promptCache = PROMPT_FALLBACK
  return promptCache
}

function emitStream(event: MuckaTextStreamEvent): void {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('mucka:text-stream', event)
}

function emitMessage(message: MuckaTextMessage): void {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('mucka:text-message', message)
}

function emitToolCall(call: MuckaTextToolCall): void {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('mucka:text-tool-call', call)
}

interface AssistantTextBlock {
  type: 'text'
  text: string
}
interface AssistantToolUseBlock {
  type: 'tool_use'
  name: string
  input?: unknown
}
type AssistantBlock = AssistantTextBlock | AssistantToolUseBlock

function blocksToSegments(blocks: AssistantBlock[]): MuckaTextSegment[] {
  const segments: MuckaTextSegment[] = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.length > 0) {
      segments.push({ kind: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      segments.push({
        kind: 'tool_call',
        toolName: block.name,
        text: `Called ${block.name}`
      })
    }
  }
  return segments
}

/**
 * Run one query turn: stream text deltas to the renderer, collect the
 * final segments, and capture the SDK session id (for resume across
 * turns + restarts). Pulled out so sendMessage can retry without resume
 * if a stale session log fails to load.
 */
async function streamTurn(
  prompt: string,
  options: Options,
  streamMessageId: string
): Promise<MuckaTextSegment[]> {
  let collected: MuckaTextSegment[] = []
  const q = query({ prompt, options })
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (msg.type === 'stream_event') {
      const event = msg.event
      if (
        event.type === 'content_block_delta' &&
        'delta' in event &&
        event.delta &&
        (event.delta as { type?: string }).type === 'text_delta' &&
        typeof (event.delta as { text?: string }).text === 'string'
      ) {
        const delta = (event.delta as { text: string }).text
        if (delta.length > 0) {
          emitStream({ messageId: streamMessageId, appendText: delta })
        }
      }
    } else if (msg.type === 'assistant') {
      const blocks = (msg.message.content ?? []) as AssistantBlock[]
      const segs = blocksToSegments(blocks)
      if (segs.length > 0) collected = collected.concat(segs)
    } else if (msg.type === 'result') {
      if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
        currentSessionId = msg.session_id
        setValue(SESSION_KEY, msg.session_id)
      }
      break
    }
  }
  return collected
}

async function runSummary(transcript: string): Promise<string> {
  const claudeBinary = packagedClaudeBinary()
  // Separate cwd so the summarizer's throwaway sessions never become the
  // chat's "most recent" session (we resume the chat by explicit id, but
  // keeping them apart is tidy and avoids any cross-talk).
  const cwd = join(app.getPath('userData'), '.mucka-summarizer')
  try {
    mkdirSync(cwd, { recursive: true })
  } catch {
    /* non-fatal */
  }
  const options: Options = {
    systemPrompt:
      'You compress conversation logs into durable memory. Given an excerpt of a chat between Tom (the operator) and Mucka (his PM agent), output 3-6 terse bullet points capturing decisions made, Tom’s stated preferences, durable facts about him or his projects, and any unresolved threads. No preamble, no headings — just the bullets.',
    cwd,
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
    allowedTools: [],
    canUseTool: async () => ({ behavior: 'deny', message: 'summarizer uses no tools' }),
    ...(MODEL ? { model: MODEL } : {})
  }
  let out = ''
  const q = query({ prompt: transcript, options })
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (msg.type === 'assistant') {
      const blocks = (msg.message.content ?? []) as AssistantBlock[]
      for (const b of blocks) {
        if (b.type === 'text') out += b.text
      }
    } else if (msg.type === 'result') {
      break
    }
  }
  return out.trim()
}

/**
 * When enough new messages pile up since the last summary, roll them into
 * one durable summary. Fire-and-forget after a turn so it never blocks
 * Mucka's reply; a no-op when under threshold or already running.
 */
async function maybeSummarize(): Promise<void> {
  if (summarizing) return
  const pending = listChatSince(lastSummarizedTs())
  if (pending.length < SUMMARY_THRESHOLD) return
  summarizing = true
  try {
    const transcript = pending
      .map(
        (m) =>
          `${m.role === 'user' ? 'Tom' : 'Mucka'}: ${m.segments.map((s) => s.text).join(' ')}`
      )
      .join('\n')
    const summary = await runSummary(transcript)
    if (summary) {
      insertSummary({
        periodStart: pending[0].ts,
        periodEnd: pending[pending.length - 1].ts,
        summary,
        messageCount: pending.length
      })
    }
  } catch {
    /* non-fatal — summaries are best-effort */
  } finally {
    summarizing = false
  }
}

export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  if (inFlight) throw new Error('Mucka is already mid-reply')

  inFlight = true
  const streamMessageId = `pending-${Date.now()}`
  let collected: MuckaTextSegment[] = []

  try {
    const userMessage = appendChat('user', [{ kind: 'text', text: trimmed }])
    emitMessage(userMessage)

    // cwd must be a real on-disk directory: in packaged builds
    // `app.getAppPath()` resolves to `…/Resources/app.asar` (a FILE),
    // and `child_process.spawn` cannot chdir into it — that was one of
    // the ENOTDIR failures. userData is always a real, writable dir.
    const claudeBinary = packagedClaudeBinary()
    const baseOptions: Options = {
      systemPrompt: loadPrompt(),
      cwd: app.getPath('userData'),
      ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
      includePartialMessages: true,
      mcpServers: { mucka: mcpServer },
      allowedTools: ALLOWED_MUCKA_TOOLS,
      // Belt-and-braces: auto-allow cockpit tools, and deny anything else
      // (built-in Read/Bash/etc.) so a stray call can never hang on a
      // permission prompt this surface can't show.
      canUseTool: async (toolName, input) => {
        if (toolName.startsWith('mcp__mucka__')) {
          return { behavior: 'allow', updatedInput: input }
        }
        return {
          behavior: 'deny',
          message: `Mucka can only use cockpit tools, not ${toolName}.`
        }
      },
      ...(MODEL ? { model: MODEL } : {})
    }

    // First turn of the boot resumes the persisted session (full prior
    // context) and carries a fresh state snapshot; later turns resume the
    // live session id. The snapshot is framed so Mucka knows it's ambient
    // context, not something she fetched.
    const isFirstTurn = !hasPriorTurnThisBoot
    const resumeId = isFirstTurn ? getValue(SESSION_KEY) : currentSessionId
    const prompt = isFirstTurn
      ? `${buildBootSnapshot()}\n\n---\n\nOperator: ${trimmed}`
      : trimmed

    try {
      collected = await streamTurn(
        prompt,
        resumeId ? { ...baseOptions, resume: resumeId } : baseOptions,
        streamMessageId
      )
    } catch (err) {
      // A resumed session log can be missing/corrupt — retry once fresh
      // so the chat never bricks just because the prior session is gone.
      if (resumeId) {
        currentSessionId = null
        collected = await streamTurn(prompt, baseOptions, streamMessageId)
      } else {
        throw err
      }
    }

    if (collected.length === 0) {
      collected = [{ kind: 'text', text: '(no reply)' }]
    }

    const persisted = appendChat('assistant', collected)
    emitMessage(persisted)
    emitStream({ messageId: streamMessageId, done: true })
    hasPriorTurnThisBoot = true
    // Fire-and-forget: roll older turns into a durable summary if enough
    // have piled up. Never blocks the reply.
    void maybeSummarize()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const persisted = appendChat('assistant', [
      { kind: 'text', text: `(agent error: ${message})` }
    ])
    emitMessage(persisted)
    emitStream({ messageId: streamMessageId, done: true })
  } finally {
    inFlight = false
  }
}

/**
 * Renderer posts a tool result here after executing it. Resolves the
 * pending dispatch promise so the MCP server can return to the model.
 */
export function acceptToolResult(result: MuckaTextToolResult): void {
  const pending = pendingCalls.get(result.callId)
  if (!pending) return
  pendingCalls.delete(result.callId)
  clearTimeout(pending.timer)
  pending.resolve(result)
}
