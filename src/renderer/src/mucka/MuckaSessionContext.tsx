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
  MicAccess,
  MuckaChatMessage,
  MuckaSessionState,
  MuckaStatus
} from '@shared/types'

interface MuckaSessionValue {
  /** Coarse state for UI. Derived from SDK + local flags. */
  state: MuckaSessionState
  /** Credential health (env-derived). Set once on mount. */
  credentialStatus: MuckaStatus
  /** Macos mic permission as last we heard. */
  micAccess: MicAccess
  /** True while a startSession round-trip is in flight. */
  connecting: boolean
  /** True when Mucka is currently speaking. */
  isSpeaking: boolean
  /** Last error string for display. Cleared on next successful start. */
  error: string | null
  /** Finalised turns, oldest first. */
  transcript: MuckaChatMessage[]
  /** Most recent Mucka turn, for the top banner. */
  lastMucka: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => void
  openMicSettings: () => Promise<void>
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

  // Guards against double-start (toggle + hotkey racing) and
  // stop-pressed-mid-connect (cancel the session as soon as it opens).
  const inFlight = useRef(false)
  const cancelOnConnect = useRef(false)

  const conversation = useConversation({
    onConnect: () => {
      setConnecting(false)
      if (cancelOnConnect.current) {
        cancelOnConnect.current = false
        conversation.endSession()
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
    }
  })

  // Fetch credential status once on mount.
  useEffect(() => {
    void window.mucka.getMuckaStatus().then(setCredentialStatus)
  }, [])

  // Ensure the mic + WS are released when the window goes away.
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
      await conversation.startSession({ signedUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setConnecting(false)
    }
  }, [conversation, micAccess])

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
      start,
      stop,
      toggle,
      openMicSettings
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
      start,
      stop,
      toggle,
      openMicSettings
    ]
  )

  return <MuckaSessionCtx.Provider value={value}>{children}</MuckaSessionCtx.Provider>
}
