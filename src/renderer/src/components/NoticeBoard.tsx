import clsx from 'clsx'
import type { NoticeBoardItem } from '@shared/types'
import { mockNoticeBoard } from '../data/mockNoticeBoard'
import { Clipboard } from './Clipboard'

const POSTIT_COLOUR: Record<NonNullable<NoticeBoardItem['colour']>, string> = {
  cream: 'bg-[#f5ecc7] text-ink',
  yellow: 'bg-[#f7e08a] text-ink',
  pink: 'bg-[#f5b7c3] text-ink',
  blue: 'bg-[#b9d3e5] text-ink'
}

export function NoticeBoard(): React.JSX.Element {
  return (
    <Clipboard
      title="Notice Board"
      subtitle="post-its"
      paper="plain"
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-2 gap-3">
          {mockNoticeBoard.map((n, idx) => (
            <article
              key={n.id}
              className={clsx(
                'relative rounded-[2px] p-2.5 font-[var(--font-hand)] shadow-[0_3px_6px_rgba(0,0,0,0.18)]',
                POSTIT_COLOUR[n.colour ?? 'cream'],
                idx % 2 === 0 ? 'rotate-[-1.2deg]' : 'rotate-[1deg]'
              )}
            >
              {/* tape strip */}
              <span
                aria-hidden
                className="absolute -top-2 left-1/2 h-3 w-12 -translate-x-1/2 -rotate-2 bg-paper-cream/70 shadow-[0_1px_1px_rgba(0,0,0,0.2)]"
              />
              <h3 className="text-[0.95rem] font-semibold leading-tight">
                {n.title}
                {n.pinned ? (
                  <span className="ml-1 text-mucka-deep">★</span>
                ) : null}
              </h3>
              <p className="mt-1 text-[0.85rem] leading-snug">{n.body}</p>
            </article>
          ))}
        </div>
      </div>
    </Clipboard>
  )
}
