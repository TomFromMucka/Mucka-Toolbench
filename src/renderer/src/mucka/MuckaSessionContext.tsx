import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ConversationProvider,
  useConversation
} from '@elevenlabs/react'
import type {
  AgentId,
  MicAccess,
  MuckaChatMessage,
  MuckaSessionState,
  MuckaStatus
} from '@shared/types'
import type { ClientTools } from '@elevenlabs/react'
import { useAgentsState } from '../state/AgentsContext'
import { buildClientTools } from './tools/index'
import { playConnectionChime } from './chime'

const REPLY_ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Feed a worker agent's freshly-finished output back into the PM chat as
 * a turn, so the PM reacts (reports to Tom / drafts a follow-up that
 * needs his sign-off). Retries if the PM is mid-reply.
 */
async function deliverAgentReply(agentId: AgentId, body: string): Promise<void> {
  const msg =
    `⟢ Auto-update from agent "${agentId}" — it finished its turn. Latest from its terminal:\n\n` +
    `${body}\n\n` +
    '(Summarise anything Tom needs to know. If a follow-up is warranted, draft it with send_to_agent for his sign-off — don\'t send silently.)'
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await window.mucka.sendChatMessage(msg)
      return
    } catch {
      // PM busy mid-reply — wait and retry.
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

export interface ConfirmRequest {
  summary: string
  note?: string
  /** Auto-deny if Tom doesn't answer within this many ms. Default 45_000. */
  timeoutMs?: number
}

export interface EditConfirmRequest extends ConfirmRequest {
  editable: { text: string; multiline?: boolean }
}

export interface PendingConfirm {
  id: string
  summary: string
  note: string | null
  expiresAt: number
  /** When set, the strip renders a textarea pre-filled with this. */
  editable: { text: string; multiline: boolean } | null
  /** Internal — ConfirmStrip calls this with the user's decision. */
  resolveSimple: ((yes: boolean) => void) | null
  resolveEdit: ((text: string | null) => void) | null
}

export type RestartVersionMap = Partial<Record<AgentId, number>>

interface MuckaSessionValue {
  state: MuckaSessionState
  credentialStatus: MuckaStatus
  micAccess: MicAccess
  connecting: boolean
  isSpeaking: boolean
  error: string | null
  transcript: MuckaChatMessage[]
  lastMucka: string | null
  /** Tool-set banner status that overrides idle and lastMucka. */
  ambientStatus: string | null
  /** Pop one per agent every time a forced respawn is needed. */
  restartVersion: RestartVersionMap
  /** Currently pending tool confirmation, null when none. */
  pendingConfirm: PendingConfirm | null

  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => void
  openMicSettings: () => Promise<void>

  setAmbientStatus: (text: string | null) => void
  bumpRestart: (agent: AgentId) => void
  requestConfirm: (req: ConfirmRequest) => Promise<boolean>
  requestEditConfirm: (req: EditConfirmRequest) => Promise<string | null>
  /** Send a typed message into the live session; auto-starts a session if needed. */
  sendUserMessage: (text: string) => Promise<void>
  /**
   * Stable tool registry used by both the voice session (passed to
   * ElevenLabs as clientTools) and the text-chat dispatcher.
   */
  clientTools: ClientTools
}

const MuckaSessionCtx = createContext<MuckaSessionValue | null>(null)

export function useMuckaSession(): MuckaSessionValue {
  const ctx = useContext(MuckaSessionCtx)
  if (!ctx) throw new Error('useMuckaSession must be used inside MuckaSessionProvider')
  return ctx
}

export function MuckaSessionProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ConversationProvider>
      <InnerProvider>{children}</InnerProvider>
    </ConversationProvider>
  )
}

function nowHHMM(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

let nextMessageId = 0

function InnerProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [transcript, setTranscript] = useState<MuckaChatMessage[]>([])
  const [credentialStatus, setCredentialStatus] = useState<MuckaStatus>({
    kind: 'ok'
  })
  const [micAccess, setMicAccess] = useState<MicAccess>('not-determined')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [ambientStatus, setAmbientStatusState] = useState<string | null>(null)
  const [restartVersion, setRestartVersion] = useState<RestartVersionMap>({})
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  const inFlight = useRef(false)
  const cancelOnConnect = useRef(false)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const pendingTextRef = useRef<string | null>(null)
  // One-shot reply watches: agentId → scrollback length at arm time +
  // whether we've since seen it go busy. When a watched agent finishes
  // (busy → idle/awaiting), its new output is fed back to the PM.
  const replyWatchRef = useRef<Map<AgentId, { baselineLen: number; sawBusy: boolean }>>(
    new Map()
  )

  const { reload: reloadAgents } = useAgentsState()

  useEffect(() => {
    pendingRef.current = pendingConfirm
  }, [pendingConfirm])

  const armReplyWatch = useCallback((agent: AgentId): void => {
    void window.mucka
      .getScrollback(agent)
      .then((sb) => {
        replyWatchRef.current.set(agent, { baselineLen: sb.length, sawBusy: false })
      })
      .catch(() => {
        replyWatchRef.current.set(agent, { baselineLen: 0, sawBusy: false })
      })
  }, [])

  // Reply loop: when a watched worker transitions busy → finished, grab
  // the output it produced since arming and hand it back to the PM.
  useEffect(() => {
    const BUSY = new Set<string>(['thinking', 'editing', 'running'])
    const FINISHED = new Set<string>(['idle', 'awaiting-input', 'done'])
    return window.mucka.onAgentStatus((event) => {
      const watch = replyWatchRef.current.get(event.agentId)
      if (!watch) return
      if (BUSY.has(event.status)) {
        watch.sawBusy = true
        return
      }
      if (!watch.sawBusy || !FINISHED.has(event.status)) return
      replyWatchRef.current.delete(event.agentId)
      const agentId = event.agentId
      void window.mucka
        .getScrollback(agentId)
        .then((sb) => {
          const fresh = sb.slice(watch.baselineLen).replace(REPLY_ANSI_RE, '').trim()
          const tail = fresh.split(/\r?\n/).slice(-60).join('\n').slice(-2500)
          void deliverAgentReply(agentId, tail.length > 0 ? tail : '(no new output captured)')
        })
        .catch(() => {
          /* best-effort */
        })
    })
  }, [])

  const conversation = useConversation({
    onConnect: () => {
      setConnecting(false)
      playConnectionChime()
      if (cancelOnConnect.current) {
        cancelOnConnect.current = false
        conversation.endSession()
        pendingTextRef.current = null
        return
      }
      const pendingText = pendingTextRef.current
      if (pendingText) {
        pendingTextRef.current = null
        try {
          conversation.sendUserMessage(pendingText)
        } catch {
          /* SDK not ready yet — drop. */
        }
      }
    },
    onDisconnect: () => {
      setConnecting(false)
    },
    onError: (message: string) => {
      setError(message)
      setConnecting(false)
    },
    onMessage: ({ message, source }) => {
      if (!message) return
      const id = `m${++nextMessageId}`
      setTranscript((prev) => [
        ...prev,
        {
          id,
          from: source === 'ai' ? 'mucka' : 'tom',
          timestamp: nowHHMM(),
          text: message
        }
      ])
      try {
        window.mucka?.appendVoiceTranscript({
          role: source === 'ai' ? 'assistant' : 'user',
          text: message,
          ts: Date.now()
        })
      } catch {
        /* fire-and-forget — chat panel still works without persistence */
      }
    },
    onUnhandledClientToolCall: (call) => {
      console.warn('[mucka] unhandled client tool call from agent:', call)
    }
  })

  useEffect(() => {
    void window.mucka.getMuckaStatus().then(setCredentialStatus)
  }, [])

  useEffect(() => {
    const handler = (): void => {
      try {
        conversation.endSession()
      } catch {
        /* nothing to do */
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [conversation])

  // ── Action surface for tools + UI ───────────────────────────────────
  const setAmbientStatus = useCallback((text: string | null): void => {
    setAmbientStatusState(text)
  }, [])

  const bumpRestart = useCallback((agent: AgentId): void => {
    setRestartVersion((prev) => ({ ...prev, [agent]: (prev[agent] ?? 0) + 1 }))
  }, [])

  const requestConfirm = useCallback(
    (req: ConfirmRequest): Promise<boolean> => {
      if (pendingRef.current) {
        return Promise.reject(
          new Error(
            'Another confirmation is already pending — finish it before asking for another.'
          )
        )
      }
      return new Promise<boolean>((resolve) => {
        const id = `c${Date.now().toString(36)}`
        const timeoutMs = req.timeoutMs ?? 45_000
        let timer: ReturnType<typeof setTimeout>
        const finish = (yes: boolean): void => {
          clearTimeout(timer)
          pendingRef.current = null
          setPendingConfirm(null)
          resolve(yes)
        }
        timer = setTimeout(() => finish(false), timeoutMs)
        const entry: PendingConfirm = {
          id,
          summary: req.summary,
          note: req.note ?? null,
          expiresAt: Date.now() + timeoutMs,
          editable: null,
          resolveSimple: finish,
          resolveEdit: null
        }
        pendingRef.current = entry
        setPendingConfirm(entry)
      })
    },
    []
  )

  const requestEditConfirm = useCallback(
    (req: EditConfirmRequest): Promise<string | null> => {
      if (pendingRef.current) {
        return Promise.reject(
          new Error(
            'Another confirmation is already pending — finish it before asking for another.'
          )
        )
      }
      return new Promise<string | null>((resolve) => {
        const id = `c${Date.now().toString(36)}`
        const timeoutMs = req.timeoutMs ?? 60_000
        let timer: ReturnType<typeof setTimeout>
        const finish = (text: string | null): void => {
          clearTimeout(timer)
          pendingRef.current = null
          setPendingConfirm(null)
          resolve(text)
        }
        timer = setTimeout(() => finish(null), timeoutMs)
        const entry: PendingConfirm = {
          id,
          summary: req.summary,
          note: req.note ?? null,
          expiresAt: Date.now() + timeoutMs,
          editable: {
            text: req.editable.text,
            multiline: req.editable.multiline ?? false
          },
          resolveSimple: null,
          resolveEdit: finish
        }
        pendingRef.current = entry
        setPendingConfirm(entry)
      })
    },
    []
  )

  // ── Shared tool registry used by voice + text ──────────────────────
  const clientTools = useMemo<ClientTools>(
    () =>
      buildClientTools({
        setAmbientStatus,
        bumpRestart,
        requestConfirm,
        requestEditConfirm,
        reloadAgents,
        armReplyWatch
      }),
    [setAmbientStatus, bumpRestart, requestConfirm, requestEditConfirm, reloadAgents, armReplyWatch]
  )

  // ── Session lifecycle ──────────────────────────────────────────────
  const start = useCallback(async () => {
    if (inFlight.current) return
    if (conversation.status === 'connected' || conversation.status === 'connecting') return
    inFlight.current = true
    cancelOnConnect.current = false
    setError(null)
    setConnecting(true)

    try {
      const status = await window.mucka.getMuckaStatus()
      setCredentialStatus(status)
      if (status.kind !== 'ok') {
        setError(
          status.kind === 'missing-key'
            ? 'Set ELEVENLABS_API_KEY in your env to enable voice.'
            : status.kind === 'missing-agent'
              ? 'Set MUCKA_AGENT_ID in your env to enable voice.'
              : status.kind === 'error'
                ? status.message
                : 'Voice unavailable.'
        )
        return
      }

      if (micAccess !== 'granted') {
        const grant = await window.mucka.requestMicAccess()
        setMicAccess(grant)
        if (grant !== 'granted') {
          setError(
            'Microphone access denied. Enable it in System Settings → Privacy → Microphone.'
          )
          return
        }
      }

      const signedUrl = await window.mucka.mintMuckaSignedUrl()
      await conversation.startSession({
        signedUrl,
        clientTools
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setConnecting(false)
    }
  }, [conversation, micAccess, clientTools])

  const stop = useCallback(async () => {
    if (inFlight.current && conversation.status !== 'connected') {
      cancelOnConnect.current = true
      return
    }
    try {
      conversation.endSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [conversation])

  const toggle = useCallback(() => {
    if (
      conversation.status === 'connected' ||
      conversation.status === 'connecting' ||
      inFlight.current
    ) {
      void stop()
    } else {
      void start()
    }
  }, [conversation.status, start, stop])

  const openMicSettings = useCallback(async () => {
    await window.mucka.openMicSettings()
  }, [])

  const sendUserMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (conversation.status === 'connected') {
        try {
          conversation.sendUserMessage(trimmed)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
        return
      }
      // Queue it; onConnect will flush.
      pendingTextRef.current = trimmed
      await start()
    },
    [conversation, start]
  )

  const state: MuckaSessionState = useMemo(() => {
    if (error) return 'error'
    if (connecting || conversation.status === 'connecting') return 'connecting'
    if (conversation.status === 'connected') {
      return conversation.isSpeaking ? 'speaking' : 'listening'
    }
    return 'idle'
  }, [connecting, conversation.status, conversation.isSpeaking, error])

  const lastMucka = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const m = transcript[i]
      if (m && m.from === 'mucka') return m.text
    }
    return null
  }, [transcript])

  const value = useMemo<MuckaSessionValue>(
    () => ({
      state,
      credentialStatus,
      micAccess,
      connecting,
      isSpeaking: conversation.isSpeaking,
      error,
      transcript,
      lastMucka,
      ambientStatus,
      restartVersion,
      pendingConfirm,
      start,
      stop,
      toggle,
      openMicSettings,
      setAmbientStatus,
      bumpRestart,
      requestConfirm,
      requestEditConfirm,
      sendUserMessage,
      clientTools
    }),
    [
      state,
      credentialStatus,
      micAccess,
      connecting,
      conversation.isSpeaking,
      error,
      transcript,
      lastMucka,
      ambientStatus,
      restartVersion,
      pendingConfirm,
      start,
      stop,
      toggle,
      openMicSettings,
      setAmbientStatus,
      bumpRestart,
      requestConfirm,
      requestEditConfirm,
      sendUserMessage,
      clientTools
    ]
  )

  return <MuckaSessionCtx.Provider value={value}>{children}</MuckaSessionCtx.Provider>
}
