import clsx from 'clsx'
import type { Notice, NoticeColour } from '@shared/types'
import { useNoticesState } from '../state/NoticesContext'
import { Clipboard } from './Clipboard'

const POSTIT_COLOUR: Record<NoticeColour, string> = {
  cream: 'bg-[#f5ecc7] text-ink',
  yellow: 'bg-[#f7e08a] text-ink',
  pink: 'bg-[#f5b7c3] text-ink',
  blue: 'bg-[#b9d3e5] text-ink'
}

export function NoticeBoard(): React.JSX.Element {
  const { notices, loading } = useNoticesState()

  return (
    <Clipboard
      title="Notice Board"
      subtitle="post-its"
      paper="plain"
      rightSlot={
        <span className="text-paper-cream/65">
          {loading ? '…' : `${notices.length}`}
        </span>
      }
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        {notices.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="max-w-[80%] text-center font-[var(--font-hand)] text-[0.92rem] leading-snug text-ink-faint">
              Empty board. Ask Mucka to add a notice.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {notices.map((n: Notice, idx) => (
              <article
                key={n.id}
                className={clsx(
                  'relative rounded-[2px] p-2.5 font-[var(--font-hand)] shadow-[0_3px_6px_rgba(0,0,0,0.18)]',
                  POSTIT_COLOUR[n.colour],
                  idx % 2 === 0 ? 'rotate-[-1.2deg]' : 'rotate-[1deg]'
                )}
              >
                <span
                  aria-hidden
                  className="absolute -top-2 left-1/2 h-3 w-12 -translate-x-1/2 -rotate-2 bg-paper-cream/70 shadow-[0_1px_1px_rgba(0,0,0,0.2)]"
                />
                <h3 className="text-[0.95rem] font-semibold leading-tight">
                  {n.title}
                  {n.pinned ? <span className="ml-1 text-mucka-deep">★</span> : null}
                </h3>
                <p className="mt-1 text-[0.85rem] leading-snug">{n.body}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </Clipboard>
  )
}
