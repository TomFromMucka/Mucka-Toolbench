import type { PreviewSlot } from '@shared/types'
import { Clipboard } from './Clipboard'

interface BrowserPreviewProps {
  slot: PreviewSlot
}

export function BrowserPreview({
  slot
}: BrowserPreviewProps): React.JSX.Element {
  const subtitle = slot.agentId ? `${slot.agentId} · preview` : 'no agent'

  return (
    <Clipboard
      title="Preview"
      subtitle={subtitle}
      paper="plain"
      rightSlot={
        <span className="font-mono text-paper-cream/70 text-[0.65rem]">
          {slot.url ?? 'mock'}
        </span>
      }
      className="min-h-0"
      bodyClassName="bg-[#10171c]"
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* fake address bar */}
        <div className="flex items-center gap-2 border-b border-black/40 bg-[#1d2730] px-2 py-1">
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full bg-[#ff5f57]" />
            <span className="size-2 rounded-full bg-[#febc2e]" />
            <span className="size-2 rounded-full bg-[#28c840]" />
          </div>
          <div className="ml-1 flex-1 truncate rounded-sm bg-[#0c1418] px-2 py-1 font-mono text-[0.7rem] text-paper-cream/70">
            {slot.url ?? `http://localhost:300${slot.id === 'left' ? '1' : '2'}`}
          </div>
        </div>

        {/* iframe / placeholder */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {slot.url ? (
            <iframe
              title={`preview-${slot.id}`}
              src={slot.url}
              className="size-full border-0"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="grid h-full place-items-center px-4">
              <div className="paper-grid w-full rounded-sm border border-ink/15 p-4 font-[var(--font-hand)] text-[0.92rem] leading-snug text-ink-soft shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
                <p className="font-semibold text-ink">Dev server not wired yet.</p>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[0.75rem] text-ink-soft">
                  {slot.placeholder}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </Clipboard>
  )
}
