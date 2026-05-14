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
      <div
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-sans text-[0.7rem] uppercase tracking-wide',
          'bg-mucka/15 text-mucka-deep'
        )}
      >
        <span className="font-mono text-[0.7rem]">⚙</span>
        <span>{segment.toolName ?? 'tool'}</span>
      </div>
    )
  }
  return (
    <div
      className={clsx(
        'max-w-[88%] rounded-md px-2.5 py-1.5 font-[var(--font-hand)] text-[0.92rem] leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.12)] whitespace-pre-wrap',
        role === 'assistant'
          ? 'bg-mucka/95 text-paper-cream'
          : 'bg-ink/10 text-ink'
      )}
    >
      {segment.text}
    </div>
  )
}

function ChatMessage({ message }: { message: MuckaTextMessage }): React.JSX.Element {
  const side = message.role === 'user' ? 'items-end' : 'items-start'
  const label = message.role === 'user' ? 'Tom' : 'Mucka'
  return (
    <div className={clsx('flex flex-col gap-1', side)}>
      {message.segments.map((seg, idx) => (
        <SegmentBubble key={idx} segment={seg} role={message.role} />
      ))}
      <span className="text-[0.65rem] text-ink-faint">
        {label} · {formatTime(message.ts)}
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
      paper="plain"
      rightSlot={<span className="text-paper-cream/65">{indicator}</span>}
      className="min-h-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        >
          {textMissing ? (
            <div className="rounded-md bg-status-warn/15 px-3 py-2 font-[var(--font-hand)] text-[0.88rem] leading-snug text-ink-soft">
              <strong className="text-ink">ANTHROPIC_API_KEY missing.</strong>{' '}
              Add it to <span className="font-mono text-[0.78rem]">.env</span> and
              restart to enable text chat. Voice still works.
            </div>
          ) : null}

          {messages.length === 0 && !textMissing ? (
            <div className="grid h-full place-items-center">
              <p className="max-w-[80%] text-center font-[var(--font-hand)] text-[0.92rem] leading-snug text-ink-faint">
                {PLACEHOLDER}
              </p>
            </div>
          ) : (
            messages.map((m) => <ChatMessage key={m.id} message={m} />)
          )}

          {streaming ? (
            <div className="flex items-start">
              <div className="inline-flex items-center gap-1 rounded-md bg-mucka/95 px-2.5 py-1.5 text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:240ms]" />
              </div>
            </div>
          ) : null}

          {!streaming && isSpeaking ? (
            <div className="flex items-start">
              <div className="inline-flex items-center gap-2 rounded-md bg-mucka/95 px-2.5 py-1.5 text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                <span className="text-[0.72rem] uppercase tracking-wide opacity-80">voice</span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:120ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:240ms]" />
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md bg-status-bad/15 px-3 py-2 font-[var(--font-hand)] text-[0.85rem] text-status-bad">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-ink/15 bg-paper-shadow/60 px-2 py-1.5">
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
              'flex-1 rounded-sm bg-paper-cream px-2 py-1 font-[var(--font-hand)] text-[0.92rem] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-mucka/50',
              !textOk && 'cursor-not-allowed text-ink-faint'
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!textOk || streaming || draft.trim().length === 0}
            className={clsx(
              'rounded-sm px-2 py-1 text-[0.72rem] font-semibold uppercase tracking-wide text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
              draft.trim().length > 0 && textOk && !streaming
                ? 'bg-mucka hover:bg-mucka-deep'
                : 'cursor-not-allowed bg-mucka/40 text-paper-cream/70'
            )}
          >
            send
          </button>
        </div>
      </div>
    </Clipboard>
  )
}
