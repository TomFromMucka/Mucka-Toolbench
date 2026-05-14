import { useState } from 'react'
import type { AgentConfig } from '@shared/types'
import { Clipboard } from './Clipboard'

interface BrowserPreviewProps {
  slotId: 'left' | 'right'
  agent: AgentConfig | null
}

export function BrowserPreview({
  slotId,
  agent
}: BrowserPreviewProps): React.JSX.Element {
  const [reloadKey, setReloadKey] = useState(0)
  const url = agent?.previewUrl ?? null
  const subtitle = agent ? `${agent.displayName.toLowerCase()} · preview` : 'no agent'
  const placeholderPort = slotId === 'left' ? '3001' : '3002'

  return (
    <Clipboard
      title="Preview"
      subtitle={subtitle}
      paper="plain"
      rightSlot={
        url ? (
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-sm border border-paper-cream/30 px-2 py-0.5 font-sans text-[0.7rem] uppercase tracking-wide text-paper-cream/85 hover:bg-paper-cream/15"
            title="Reload iframe"
          >
            reload
          </button>
        ) : (
          <span className="font-mono text-paper-cream/70 text-[0.65rem]">no url</span>
        )
      }
      className="min-h-0"
      bodyClassName="bg-[#10171c]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-black/40 bg-[#1d2730] px-2 py-1">
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full bg-[#ff5f57]" />
            <span className="size-2 rounded-full bg-[#febc2e]" />
            <span className="size-2 rounded-full bg-[#28c840]" />
          </div>
          <div className="ml-1 flex-1 truncate rounded-sm bg-[#0c1418] px-2 py-1 font-mono text-[0.7rem] text-paper-cream/70">
            {url ?? `http://localhost:${placeholderPort}`}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {url ? (
            <iframe
              key={`${url}#${reloadKey}`}
              title={`preview-${slotId}`}
              src={url}
              className="size-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="grid h-full place-items-center px-4">
              <div className="paper-grid w-full rounded-sm border border-ink/15 p-4 font-[var(--font-hand)] text-[0.92rem] leading-snug text-ink-soft shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
                <p className="font-semibold text-ink">
                  {agent
                    ? `No preview URL set for ${agent.displayName}.`
                    : 'No agent assigned to this preview slot.'}
                </p>
                <p className="mt-2 text-[0.82rem] text-ink-soft">
                  Set one in Settings (⌘,) — point it at the agent&apos;s dev
                  server (e.g. http://localhost:{placeholderPort}).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Clipboard>
  )
}
