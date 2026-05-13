import clsx from 'clsx'
import { mockJobSheet } from '../data/mockJobSheet'
import { Clipboard } from './Clipboard'

const AGENT_TAG_COLOUR: Record<string, string> = {
  dave: 'bg-[#5a7a8a] text-paper-cream',
  sammy: 'bg-mucka text-paper-cream',
  kev: 'bg-[#7a6a4a] text-paper-cream',
  bren: 'bg-[#6a7a5a] text-paper-cream',
  mucka: 'bg-mucka-deep text-paper-cream',
  system: 'bg-ink-faint text-paper-cream'
}

export function JobSheet(): React.JSX.Element {
  return (
    <Clipboard
      title="Job Sheet"
      subtitle="activity log"
      paper="lined"
      rightSlot={<span>{mockJobSheet.length} entries</span>}
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto px-3 py-2">
        <ol className="space-y-[3px]">
          {mockJobSheet.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[42px_60px_1fr] items-baseline gap-2 font-[var(--font-hand)] text-[0.93rem] leading-[28px]"
            >
              <span className="text-ink-faint tabular-nums">
                {entry.timestamp}
              </span>
              <span
                className={clsx(
                  'inline-flex justify-center rounded-sm px-1.5 py-px text-[0.65rem] uppercase tracking-wider',
                  AGENT_TAG_COLOUR[entry.agent] ?? AGENT_TAG_COLOUR.system
                )}
              >
                {entry.agent}
              </span>
              <span
                className={clsx(
                  'truncate',
                  entry.tone === 'attention' && 'text-mucka-deep font-semibold',
                  entry.tone === 'win' && 'text-status-ok font-semibold',
                  !entry.tone && 'text-ink'
                )}
              >
                {entry.message}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Clipboard>
  )
}
