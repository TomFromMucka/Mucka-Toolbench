import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Clipboard } from './Clipboard'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

const PLACEHOLDER =
  "When you're ready, hit ⌘M to talk or just type below."

export function MuckaChat(): React.JSX.Element {
  const { transcript, state, isSpeaking, sendUserMessage, credentialStatus } =
    useMuckaSession()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [transcript.length, isSpeaking])

  const indicator =
    state === 'listening'
      ? 'live · listening'
      : state === 'speaking'
        ? 'live · Mucka'
        : state === 'connecting'
          ? 'connecting'
          : state === 'error'
            ? 'voice issue'
            : 'idle'

  const credsOk = credentialStatus.kind === 'ok'

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || sending || !credsOk) return
    setSending(true)
    setDraft('')
    try {
      await sendUserMessage(text)
    } finally {
      setSending(false)
    }
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
      subtitle="PM banter"
      paper="plain"
      rightSlot={<span className="text-paper-cream/65">{indicator}</span>}
      className="min-h-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        >
          {transcript.length === 0 ? (
            <div className="grid h-full place-items-center">
              <p className="max-w-[80%] text-center font-[var(--font-hand)] text-[0.92rem] leading-snug text-ink-faint">
                {PLACEHOLDER}
              </p>
            </div>
          ) : (
            transcript.map((m) => (
              <div
                key={m.id}
                className={clsx(
                  'flex flex-col',
                  m.from === 'tom' ? 'items-end' : 'items-start'
                )}
              >
                <div
                  className={clsx(
                    'max-w-[88%] rounded-md px-2.5 py-1.5 font-[var(--font-hand)] text-[0.92rem] leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.12)]',
                    m.from === 'mucka'
                      ? 'bg-mucka/95 text-paper-cream'
                      : 'bg-ink/10 text-ink'
                  )}
                >
                  {m.text}
                </div>
                <span className="mt-0.5 text-[0.65rem] text-ink-faint">
                  {m.from === 'mucka' ? 'Mucka' : 'Tom'} · {m.timestamp}
                </span>
              </div>
            ))
          )}

          {isSpeaking ? (
            <div className="flex items-start">
              <div className="inline-flex items-center gap-1 rounded-md bg-mucka/95 px-2.5 py-1.5 text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-paper-cream/85 [animation-delay:240ms]" />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-ink/15 bg-paper-shadow/60 px-2 py-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            disabled={!credsOk || sending}
            placeholder={
              credsOk
                ? state === 'listening' || state === 'speaking'
                  ? 'Type to Mucka…'
                  : 'Type — starts a session and sends'
                : 'Voice unavailable — check env vars'
            }
            className={clsx(
              'flex-1 rounded-sm bg-paper-cream px-2 py-1 font-[var(--font-hand)] text-[0.92rem] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-mucka/50',
              !credsOk && 'cursor-not-allowed text-ink-faint'
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!credsOk || sending || draft.trim().length === 0}
            className={clsx(
              'rounded-sm px-2 py-1 text-[0.72rem] font-semibold uppercase tracking-wide text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
              draft.trim().length > 0 && credsOk && !sending
                ? 'bg-mucka hover:bg-mucka-deep'
                : 'cursor-not-allowed bg-mucka/40 text-paper-cream/70'
            )}
          >
            {sending ? '…' : 'send'}
          </button>
        </div>
      </div>
    </Clipboard>
  )
}
