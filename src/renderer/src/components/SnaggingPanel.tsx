import clsx from 'clsx'
import type { SnagItem } from '@shared/types'
import { mockSnags } from '../data/mockSnags'
import { Clipboard } from './Clipboard'

const SEVERITY: Record<SnagItem['severity'], string> = {
  info: 'bg-ink-faint text-paper-cream',
  warn: 'bg-status-warn text-ink',
  error: 'bg-status-bad text-paper-cream'
}

const SOURCE_LABEL: Record<SnagItem['source'], string> = {
  typecheck: 'tsc',
  lint: 'lint',
  test: 'test',
  build: 'build',
  runtime: 'run'
}

export function SnaggingPanel(): React.JSX.Element {
  const errors = mockSnags.filter((s) => s.severity === 'error').length
  const warns = mockSnags.filter((s) => s.severity === 'warn').length

  return (
    <Clipboard
      title="Snagging List"
      subtitle="CI · type · lint · test"
      paper="lined"
      rightSlot={
        <span className="flex items-center gap-2">
          {errors > 0 ? (
            <span className="rounded-sm bg-status-bad px-1.5 py-px text-[0.62rem] uppercase tracking-wide">
              {errors} err
            </span>
          ) : null}
          {warns > 0 ? (
            <span className="rounded-sm bg-status-warn px-1.5 py-px text-[0.62rem] uppercase tracking-wide text-ink">
              {warns} warn
            </span>
          ) : null}
        </span>
      }
      className="min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto px-3 py-2">
        <ol className="space-y-[2px]">
          {mockSnags.map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[44px_52px_56px_1fr] items-baseline gap-2 font-[var(--font-hand)] text-[0.92rem] leading-[28px]"
            >
              <span
                className={clsx(
                  'inline-flex justify-center rounded-sm px-1.5 py-px text-[0.6rem] uppercase tracking-wider',
                  SEVERITY[s.severity]
                )}
              >
                {s.severity}
              </span>
              <span className="text-ink-faint">{SOURCE_LABEL[s.source]}</span>
              <span className="text-ink-soft">{s.agent}</span>
              <span className="truncate text-ink">{s.description}</span>
            </li>
          ))}
        </ol>
      </div>
    </Clipboard>
  )
}
