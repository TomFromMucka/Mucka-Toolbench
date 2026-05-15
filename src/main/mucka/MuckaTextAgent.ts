import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  MuckaTextMessage,
  MuckaTextSegment,
  MuckaTextStatus,
  MuckaTextStreamEvent
} from '@shared/types'
import { appendChat, clearChat, listChat } from '../db/chat'

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

let webContents: WebContents | null = null
let promptCache: string | null = null
let inFlight = false
let hasPriorTurnThisBoot = false

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

export function clearHistory(): void {
  clearChat()
  // After a wipe we should not try to resume the prior SDK session.
  hasPriorTurnThisBoot = false
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

function loadPrompt(): string {
  if (promptCache !== null) return promptCache
  try {
    const path = join(__dirname, '../../src/main/mucka/prompts/pm.md')
    promptCache = readFileSync(path, 'utf8')
  } catch {
    try {
      const fallback = join(__dirname, 'mucka/prompts/pm.md')
      promptCache = readFileSync(fallback, 'utf8')
    } catch {
      promptCache = PROMPT_FALLBACK
    }
  }
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

    const options: Options = {
      systemPrompt: loadPrompt(),
      cwd: app.getAppPath(),
      includePartialMessages: true,
      // Resume the SDK's session log from prior turns this boot so it
      // sees the running conversation. The first turn of a fresh cockpit
      // boot starts a new session.
      ...(hasPriorTurnThisBoot ? { continue: true } : {}),
      ...(MODEL ? { model: MODEL } : {})
    }

    const q = query({ prompt: trimmed, options })

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
        // Final assistant turn — pull out content blocks.
        const blocks = (msg.message.content ?? []) as AssistantBlock[]
        const segs = blocksToSegments(blocks)
        if (segs.length > 0) collected = collected.concat(segs)
      } else if (msg.type === 'result') {
        // Done with this turn — break out of the loop.
        break
      }
    }

    if (collected.length === 0) {
      collected = [{ kind: 'text', text: '(no reply)' }]
    }

    const persisted = appendChat('assistant', collected)
    emitMessage(persisted)
    emitStream({ messageId: streamMessageId, done: true })
    hasPriorTurnThisBoot = true
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
 * Slice 1 stub — tools land in slice 2. The renderer-side tool-result
 * IPC handler is still wired through `MuckaText.acceptToolResult`; once
 * the agent backend dispatches tools via MCP this becomes a no-op.
 */
export function acceptToolResult(): void {
  /* no-op until slice 2 */
}
