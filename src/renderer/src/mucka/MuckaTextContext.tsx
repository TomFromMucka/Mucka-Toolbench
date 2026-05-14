import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  MuckaTextMessage,
  MuckaTextSegment,
  MuckaTextStatus
} from '@shared/types'
import { useMuckaSession } from './MuckaSessionContext'

interface MuckaTextValue {
  status: MuckaTextStatus | null
  messages: MuckaTextMessage[]
  /** Set while a turn is in flight (between user send and assistant done). */
  streaming: boolean
  /** Last error, cleared on next send. */
  error: string | null
  send: (text: string) => Promise<void>
  clear: () => Promise<void>
}

const Ctx = createContext<MuckaTextValue | null>(null)

export function useMuckaText(): MuckaTextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMuckaText must be used inside MuckaTextProvider')
  return ctx
}

const STREAMING_ID = '__streaming__'

function makeStreamingMessage(): MuckaTextMessage {
  return {
    id: STREAMING_ID,
    ts: Date.now(),
    role: 'assistant',
    segments: []
  }
}

function appendTextToSegments(
  segments: MuckaTextSegment[],
  delta: string
): MuckaTextSegment[] {
  if (segments.length === 0) {
    return [{ kind: 'text', text: delta }]
  }
  const last = segments[segments.length - 1]
  if (last && last.kind === 'text') {
    const updated = [...segments]
    updated[updated.length - 1] = { ...last, text: last.text + delta }
    return updated
  }
  return [...segments, { kind: 'text', text: delta }]
}

export function MuckaTextProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { clientTools } = useMuckaSession()
  const [status, setStatus] = useState<MuckaTextStatus | null>(null)
  const [messages, setMessages] = useState<MuckaTextMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, history] = await Promise.all([
        window.mucka.getMuckaTextStatus(),
        window.mucka.listChatHistory()
      ])
      if (cancelled) return
      setStatus(s)
      setMessages(history)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Stream events — append text deltas and tool-call segments to a
  // transient message that lives until the assistant turn completes.
  useEffect(() => {
    const off = window.mucka.onChatStream((event) => {
      if (event.done) {
        // Drop the streaming sentinel — the final persisted message arrives
        // via onChatMessage and replaces it.
        setMessages((prev) => prev.filter((m) => m.id !== STREAMING_ID))
        setStreaming(false)
        streamingRef.current = false
        return
      }
      if (event.appendText) {
        const delta = event.appendText
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === STREAMING_ID)
          if (idx < 0) {
            const next = makeStreamingMessage()
            next.segments = appendTextToSegments([], delta)
            return [...prev, next]
          }
          const existing = prev[idx]!
          const updated = [...prev]
          updated[idx] = {
            ...existing,
            segments: appendTextToSegments(existing.segments, delta)
          }
          return updated
        })
      }
      if (event.toolCall) {
        const summary = event.toolCall.summary
        const toolName = event.toolCall.toolName
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === STREAMING_ID)
          const segment: MuckaTextSegment = {
            kind: 'tool_call',
            toolName,
            text: summary
          }
          if (idx < 0) {
            const next = makeStreamingMessage()
            next.segments = [segment]
            return [...prev, next]
          }
          const existing = prev[idx]!
          const updated = [...prev]
          updated[idx] = {
            ...existing,
            segments: [...existing.segments, segment]
          }
          return updated
        })
      }
    })
    return off
  }, [])

  // Final persisted messages — user echo + assistant final.
  useEffect(() => {
    const off = window.mucka.onChatMessage((message) => {
      setMessages((prev) => {
        // De-dupe by id, drop the streaming sentinel.
        const filtered = prev.filter(
          (m) => m.id !== STREAMING_ID && m.id !== message.id
        )
        return [...filtered, message]
      })
    })
    return off
  }, [])

  // Tool-call dispatch — invoke the shared clientTools registry.
  useEffect(() => {
    const off = window.mucka.onChatToolCall(async (call) => {
      const handler = clientTools[call.name]
      try {
        if (!handler) {
          window.mucka.sendChatToolResult({
            callId: call.callId,
            ok: false,
            result: `Unknown tool: ${call.name}`
          })
          return
        }
        const result = await handler(call.params)
        const text = typeof result === 'string' ? result : JSON.stringify(result)
        window.mucka.sendChatToolResult({
          callId: call.callId,
          ok: true,
          result: text
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        window.mucka.sendChatToolResult({
          callId: call.callId,
          ok: false,
          result: message
        })
      }
    })
    return off
  }, [clientTools])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (streamingRef.current) {
        setError('Mucka is still replying — wait for her to finish.')
        return
      }
      setError(null)
      streamingRef.current = true
      setStreaming(true)
      try {
        await window.mucka.sendChatMessage(trimmed)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        streamingRef.current = false
        setStreaming(false)
        // Drop any partial streaming message.
        setMessages((prev) => prev.filter((m) => m.id !== STREAMING_ID))
      }
    },
    []
  )

  const clear = useCallback(async () => {
    await window.mucka.clearChatHistory()
    setMessages([])
  }, [])

  const value = useMemo<MuckaTextValue>(
    () => ({ status, messages, streaming, error, send, clear }),
    [status, messages, streaming, error, send, clear]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
