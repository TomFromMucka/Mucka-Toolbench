import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageCreateParamsBase,
  MessageParam,
  Tool,
  ToolUseBlock,
  TextBlock,
  ContentBlock,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages'
import type { WebContents } from 'electron'
import type {
  MuckaTextMessage,
  MuckaTextSegment,
  MuckaTextStatus,
  MuckaTextStreamEvent,
  MuckaTextToolCall,
  MuckaTextToolResult
} from '@shared/types'
import { TOOL_DEFINITIONS } from '@shared/mucka-tools'
import { appendChat, clearChat, listChat } from '../db/chat'

const MODEL = process.env.MUCKA_TEXT_MODEL?.trim() || 'claude-sonnet-4-6'
const MAX_TOKENS = 4096
const TOOL_CALL_TIMEOUT_MS = 60_000

interface PendingCall {
  resolve: (result: MuckaTextToolResult) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

let client: Anthropic | null = null
let webContents: WebContents | null = null
let promptCache: string | null = null
let inFlight = false
const pendingCalls = new Map<string, PendingCall>()
let callCounter = 0

function getApiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim()
  return k && k.length > 0 ? k : null
}

function getClient(): Anthropic | null {
  if (client) return client
  const key = getApiKey()
  if (!key) return null
  client = new Anthropic({ apiKey: key })
  return client
}

function loadPrompt(): string {
  if (promptCache !== null) return promptCache
  try {
    const path = join(__dirname, '../../src/main/mucka/prompts/pm.md')
    promptCache = readFileSync(path, 'utf8')
  } catch {
    // Production build path — bundled prompts live next to main.
    try {
      const fallback = join(__dirname, 'mucka/prompts/pm.md')
      promptCache = readFileSync(fallback, 'utf8')
    } catch {
      promptCache = 'You are Mucka, a terse British PM for the dev cockpit.'
    }
  }
  return promptCache
}

function buildTools(): Tool[] {
  return TOOL_DEFINITIONS.map(
    (def): Tool => ({
      name: def.name,
      description: def.description,
      input_schema: {
        type: 'object',
        properties: def.parameters.properties as Record<string, unknown>,
        required: [...def.parameters.required]
      }
    })
  )
}

export function bindMuckaTextBroadcaster(wc: WebContents): void {
  webContents = wc
}

export function unbindMuckaTextBroadcaster(): void {
  webContents = null
}

export function getStatus(): MuckaTextStatus {
  if (!getApiKey()) return { kind: 'missing-key' }
  return { kind: 'ok' }
}

export function listHistory(): MuckaTextMessage[] {
  return listChat()
}

export function clearHistory(): void {
  clearChat()
}

/**
 * Renderer posts a tool result here after executing it.
 */
export function acceptToolResult(result: MuckaTextToolResult): void {
  const pending = pendingCalls.get(result.callId)
  if (!pending) return
  pendingCalls.delete(result.callId)
  clearTimeout(pending.timer)
  pending.resolve(result)
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

/**
 * Dispatch a tool call to the renderer and await its result. Times out
 * after TOOL_CALL_TIMEOUT_MS so Tom isn't stuck staring at a hung Mucka.
 */
function dispatchTool(
  name: string,
  params: Record<string, unknown>
): Promise<MuckaTextToolResult> {
  callCounter += 1
  const callId = `c${Date.now().toString(36)}${callCounter}`
  return new Promise<MuckaTextToolResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      reject(new Error(`tool ${name} timed out after ${TOOL_CALL_TIMEOUT_MS}ms`))
    }, TOOL_CALL_TIMEOUT_MS)
    pendingCalls.set(callId, { resolve, reject, timer })
    emitToolCall({ callId, name, params })
  })
}

function contentToSegments(content: ContentBlock[]): MuckaTextSegment[] {
  const segments: MuckaTextSegment[] = []
  for (const block of content) {
    if (block.type === 'text') {
      const text = (block as TextBlock).text
      if (text.length > 0) segments.push({ kind: 'text', text })
    } else if (block.type === 'tool_use') {
      const tu = block as ToolUseBlock
      segments.push({
        kind: 'tool_call',
        toolName: tu.name,
        text: `Called ${tu.name}`
      })
    }
  }
  return segments
}

function historyToParams(history: MuckaTextMessage[]): MessageParam[] {
  return history.map((m): MessageParam => {
    if (m.role === 'user') {
      // User messages from the chat history are stored as a single text segment.
      const text = m.segments
        .filter((s) => s.kind === 'text')
        .map((s) => s.text)
        .join('\n')
      return { role: 'user', content: text }
    }
    // Assistant history: text + tool_call segments. Tool calls aren't
    // recoverable for replay, but the text content is enough to seed
    // future turns. We omit tool_use blocks from history to avoid breaking
    // the API contract (would need matched tool_result blocks).
    const text = m.segments
      .filter((s) => s.kind === 'text')
      .map((s) => s.text)
      .join('')
    if (!text) {
      return { role: 'assistant', content: '(no reply)' }
    }
    return { role: 'assistant', content: text }
  })
}

/**
 * Send a user text message; run the Claude tool-use loop; stream back.
 * Resolves once the assistant turn is complete (or errored).
 */
export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const c = getClient()
  if (!c) throw new Error('ANTHROPIC_API_KEY not set')
  if (inFlight) throw new Error('Mucka is already mid-reply')

  inFlight = true
  try {
    const userMessage = appendChat('user', [{ kind: 'text', text: trimmed }])
    emitMessage(userMessage)

    // Build history (everything up to and including the new user message).
    const history = listChat()
    const baseMessages = historyToParams(history)

    const tools = buildTools()
    const system = loadPrompt()

    // Per-turn collected segments. We build one assistant message that
    // grows across tool-use rounds, ending when stop_reason !== 'tool_use'.
    const collectedSegments: MuckaTextSegment[] = []
    let workingMessages: MessageParam[] = baseMessages
    let assistantMessageId: string | null = null

    // Keep a stable id for stream events.
    const streamMessageId = `pending-${Date.now()}`

    while (true) {
      const params: MessageCreateParamsBase = {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
        ],
        tools,
        messages: workingMessages
      }

      const stream = c.messages.stream(params)

      stream.on('text', (delta: string) => {
        if (delta.length === 0) return
        emitStream({ messageId: streamMessageId, appendText: delta })
      })

      stream.on('streamEvent', (event) => {
        if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          const tb = event.content_block as ToolUseBlock
          emitStream({
            messageId: streamMessageId,
            toolCall: { toolName: tb.name, summary: `Called ${tb.name}` }
          })
        }
      })

      const final = await stream.finalMessage()
      const newSegments = contentToSegments(final.content)
      collectedSegments.push(...newSegments)

      // Bookkeeping for the next loop iteration: append the assistant
      // message (with its tool_use blocks) and then tool_results.
      workingMessages = [
        ...workingMessages,
        { role: 'assistant', content: final.content }
      ]

      if (final.stop_reason !== 'tool_use') {
        break
      }

      const toolUses = final.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      )
      const toolResults: ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        try {
          const params = (tu.input ?? {}) as Record<string, unknown>
          const result = await dispatchTool(tu.name, params)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.result || '(empty)',
            is_error: !result.ok
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: message,
            is_error: true
          })
        }
      }

      workingMessages = [
        ...workingMessages,
        { role: 'user', content: toolResults }
      ]
    }

    // Persist + emit the assembled assistant message.
    const persisted = appendChat('assistant', collectedSegments)
    assistantMessageId = persisted.id
    emitMessage(persisted)
    emitStream({ messageId: streamMessageId, done: true })
    void assistantMessageId
  } finally {
    inFlight = false
  }
}
