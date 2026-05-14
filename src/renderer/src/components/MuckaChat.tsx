import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { MuckaTextMessage, MuckaTextSegment } from '@shared/types'
import { Clipboard } from './Clipboard'
import { useMuckaSession } from '../mucka/MuckaSessionContext'
import { useMuckaText } from '../mucka/MuckaTextContext'

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
  const label = message.role === 'user' ? 'Tom' : 'Mucka'
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

export function MuckaChat(): React.JSX.Element {
  const { state, isSpeaking, credentialStatus } = useMuckaSession()
  const { status, messages, streaming, error, send } = useMuckaText()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')

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
  const textMissing = status?.kind === 'missing-key'
  const voiceOk = credentialStatus.kind === 'ok'

  const indicator =
    voiceLabel ??
    (streaming
      ? 'Mucka typing…'
      : textOk
        ? voiceOk
          ? 'text + voice'
          : 'text mode'
        : textMissing
          ? 'text key missing'
          : 'idle')

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || streaming || !textOk) return
    setDraft('')
    await send(text)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>): void {
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
    >
      <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface)' }}>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        >
          {textMissing ? (
            <div
              className="chamfer-sm t-body-md px-3 py-2 leading-snug"
              style={{ background: 'rgba(255, 154, 74, 0.12)', color: 'var(--van-white)' }}
            >
              <strong>ANTHROPIC_API_KEY missing.</strong>{' '}
              Add it to <span className="font-mono text-[0.78rem]">.env</span> and
              restart to enable text chat. Voice still works.
            </div>
          ) : null}

          {messages.length === 0 && !textMissing ? (
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

        <div
          className="flex items-center gap-2 border-t px-2 py-1.5"
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
                  : 'Type to Mucka (Claude)…'
                : 'Set ANTHROPIC_API_KEY to enable text chat.'
            }
            className={clsx(
              'chamfer-sm t-body-md flex-1 px-2 py-1 focus:outline-none',
              !textOk && 'cursor-not-allowed'
            )}
            style={{
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
              'mucka-btn mucka-btn-primary mucka-btn-sm',
              (draft.trim().length === 0 || !textOk || streaming) &&
                'cursor-not-allowed opacity-50'
            )}
          >
            <span className="mucka-btn-label">send</span>
          </button>
        </div>
      </div>
    </Clipboard>
  )
}
