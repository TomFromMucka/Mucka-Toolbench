import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { MuckaTextMessage, MuckaTextSegment } from '@shared/types'
import { Clipboard } from './Clipboard'
import type { PanelSizeProps } from './panelSize'
import { ConfirmStrip } from './ConfirmStrip'
import { useMuckaSession } from '../mucka/MuckaSessionContext'
import { useMuckaText } from '../mucka/MuckaTextContext'
import { useAgentsState } from '../state/AgentsContext'
import { MuckaVoiceButton } from './MuckaVoiceButton'

const PLACEHOLDER =
  "Type to chat with Mucka via Claude, or hit ⌘M to talk by voice."

function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface SegmentBubbleProps {
  segment: MuckaTextSegment
  role: 'user' | 'assistant'
}

function SegmentBubble({ segment, role }: SegmentBubbleProps): React.JSX.Element {
  if (segment.kind === 'tool_call') {
    return (
      <div className="chamfer-sm inline-flex items-center gap-1.5 px-2 py-0.5 t-label-sm bg-orange/15 text-orange">
        <span className="font-mono text-[0.7rem]">⚙</span>
        <span>{segment.toolName ?? 'tool'}</span>
      </div>
    )
  }
  const isVoice = segment.source === 'voice'
  return (
    <div
      className={clsx(
        'chamfer-sm max-w-[88%] px-2.5 py-1.5 t-body-md leading-snug whitespace-pre-wrap',
        isVoice && 'italic'
      )}
      style={{
        background:
          role === 'assistant' ? 'var(--orange)' : 'rgba(234, 233, 232, 0.08)',
        color:
          role === 'assistant' ? 'var(--charcoal)' : 'var(--van-white)',
        ...(isVoice && {
          boxShadow: 'inset 3px 0 0 var(--orange)'
        })
      }}
    >
      {segment.text}
    </div>
  )
}

function messageHasVoice(m: MuckaTextMessage): boolean {
  return m.segments.some((s) => s.kind === 'text' && s.source === 'voice')
}

function ChatMessage({ message }: { message: MuckaTextMessage }): React.JSX.Element {
  const side = message.role === 'user' ? 'items-end' : 'items-start'
  const label = message.role === 'user' ? 'You' : 'Mucka'
  const viaVoice = messageHasVoice(message)
  return (
    <div className={clsx('flex flex-col gap-1', side)}>
      {message.segments.map((seg, idx) => (
        <SegmentBubble key={idx} segment={seg} role={message.role} />
      ))}
      <span className="t-label-sm text-dirty-grey">
        {label} · {viaVoice ? 'voice · ' : ''}
        {formatTime(message.ts)}
      </span>
    </div>
  )
}

export function MuckaChat({ size, onResize }: PanelSizeProps): React.JSX.Element {
  const { state, isSpeaking, credentialStatus } = useMuckaSession()
  const { status, messages, streaming, error, send } = useMuckaText()
  const { agents } = useAgentsState()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const runningCount = agents.filter((a) => a.running).length

  const showFlash = useCallback((message: string): void => {
    setFlash(message)
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current)
    }
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 3200)
  }, [])

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, streaming])

  const voiceLabel =
    state === 'listening'
      ? 'voice live'
      : state === 'speaking'
        ? 'voice · Mucka'
        : state === 'connecting'
          ? 'voice connecting'
          : null

  const textOk = status?.kind === 'ok'
  const voiceOk = credentialStatus.kind === 'ok'

  const indicator =
    voiceLabel ??
    (streaming
      ? 'Mucka typing…'
      : textOk
        ? voiceOk
          ? 'voice · text via Claude Code'
          : 'text via Claude Code'
        : 'idle')

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || streaming || !textOk) return
    setDraft('')
    await send(text)
  }

  const handleBroadcast = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text) return
    try {
      const result = await window.mucka.broadcastToAgents({ text })
      setDraft('')
      if (result.sent.length === 0) {
        showFlash(
          result.skipped.length > 0
            ? `Skipped — no running agents (${result.skipped.length} stopped)`
            : 'No agents to broadcast to'
        )
        return
      }
      const skipped = result.skipped.length > 0
        ? ` · skipped ${result.skipped.length}`
        : ''
      showFlash(`Broadcast → ${result.sent.join(', ')}${skipped}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showFlash(`Broadcast failed: ${message}`)
    }
  }, [draft, showFlash])

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleBroadcast()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <Clipboard
      title="Mucka — chat"
      subtitle="text via Claude · voice via ElevenLabs"
      rightSlot={<span>{indicator}</span>}
      className="min-h-0"
      size={size}
      onResize={onResize}
    >
      <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface)' }}>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        >
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center">
              <p className="t-body-md max-w-[80%] text-center leading-snug text-dirty-grey">
                {PLACEHOLDER}
              </p>
            </div>
          ) : (
            messages.map((m) => <ChatMessage key={m.id} message={m} />)
          )}

          {streaming ? (
            <div className="flex items-start">
              <div
                className="chamfer-sm inline-flex items-center gap-1 px-2.5 py-1.5"
                style={{ background: 'var(--orange)', color: 'var(--charcoal)' }}
              >
                <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:240ms]" />
              </div>
            </div>
          ) : null}

          {!streaming && isSpeaking ? (
            <div className="flex items-start">
              <div
                className="chamfer-sm inline-flex items-center gap-2 px-2.5 py-1.5"
                style={{ background: 'var(--orange)', color: 'var(--charcoal)' }}
              >
                <span className="t-label-sm opacity-75">voice</span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:120ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-charcoal/70 [animation-delay:240ms]" />
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="chamfer-sm t-body-md px-3 py-2"
              style={{ background: 'rgba(255, 90, 74, 0.15)', color: 'var(--van-white)' }}
            >
              {error}
            </div>
          ) : null}
        </div>

        {flash ? (
          <div
            className="border-t px-3 py-1 t-label-sm"
            style={{
              borderColor: 'var(--border)',
              background: 'rgba(255, 78, 0, 0.10)',
              color: 'var(--orange)',
              fontFamily: 'var(--font-soehne)'
            }}
          >
            {flash}
          </div>
        ) : null}
        <ConfirmStrip />
        <div
          className="flex items-center gap-2 border-t px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            disabled={!textOk || streaming}
            placeholder={
              textOk
                ? streaming
                  ? 'Mucka is replying…'
                  : runningCount > 0
                    ? `Type to Mucka · ⌘⏎ broadcast to ${runningCount} agent${runningCount === 1 ? '' : 's'}`
                    : 'Type to Mucka (Claude)…'
                : 'Run `claude login` to enable text chat.'
            }
            className={clsx(
              'chamfer-sm t-body-md flex-1 px-3 focus:outline-none',
              !textOk && 'cursor-not-allowed'
            )}
            style={{
              height: '34px',
              background: 'var(--surface)',
              color: 'var(--van-white)',
              fontFamily: 'var(--font-soehne)'
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!textOk || streaming || draft.trim().length === 0}
            className={clsx(
              'mucka-btn mucka-btn-primary mucka-btn-sm shrink-0',
              (draft.trim().length === 0 || !textOk || streaming) &&
                'cursor-not-allowed opacity-50'
            )}
          >
            <span className="mucka-btn-label">send</span>
          </button>
          <MuckaVoiceButton />
        </div>
      </div>
    </Clipboard>
  )
}
