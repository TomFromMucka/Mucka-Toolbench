import clsx from 'clsx'
import { mockMuckaChat } from '../data/mockMucka'
import { Clipboard } from './Clipboard'

export function MuckaChat(): React.JSX.Element {
  return (
    <Clipboard
      title="Mucka — chat"
      subtitle="PM banter"
      paper="plain"
      rightSlot={<span className="text-paper-cream/60">live</span>}
      className="min-h-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
          {mockMuckaChat.map((m) => (
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
          ))}
        </div>

        {/* Reply stub (visual only) */}
        <div className="flex items-center gap-2 border-t border-ink/15 bg-paper-shadow/60 px-2 py-1.5">
          <input
            type="text"
            disabled
            placeholder="Reply to Mucka…"
            className="flex-1 rounded-sm bg-paper-cream px-2 py-1 font-[var(--font-hand)] text-[0.92rem] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="button"
            disabled
            className="rounded-sm bg-mucka/80 px-2 py-1 text-[0.72rem] font-semibold uppercase tracking-wide text-paper-cream"
          >
            send
          </button>
        </div>
      </div>
    </Clipboard>
  )
}
