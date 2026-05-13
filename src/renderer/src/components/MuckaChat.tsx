import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { Clipboard } from './Clipboard'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

const PLACEHOLDER =
  "When you're ready to talk, hit ⌘M. Mucka will reply with the voice."

export function MuckaChat(): React.JSX.Element {
  const { transcript, state, isSpeaking } = useMuckaSession()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-stick to the bottom as new turns arrive.
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
            disabled
            placeholder="Voice only for now — text reply coming later"
            className="flex-1 cursor-not-allowed rounded-sm bg-paper-cream px-2 py-1 font-[var(--font-hand)] text-[0.92rem] text-ink-faint placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-sm bg-mucka/40 px-2 py-1 text-[0.72rem] font-semibold uppercase tracking-wide text-paper-cream/70"
          >
            send
          </button>
        </div>
      </div>
    </Clipboard>
  )
}
