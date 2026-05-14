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
      rightSlot={
        url ? (
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="t-label-sm chamfer-sm px-2 py-0.5"
            style={{
              background: 'rgba(234, 233, 232, 0.12)',
              color: 'var(--van-white)'
            }}
            title="Reload iframe"
          >
            reload
          </button>
        ) : (
          <span className="font-mono text-[0.65rem] text-dirty-grey">no url</span>
        )
      }
      className="min-h-0"
      bodyClassName="bg-surface-2"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex items-center gap-2 border-b px-2 py-1"
          style={{ background: 'var(--charcoal)', borderColor: 'var(--border)' }}
        >
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full" style={{ background: '#ff5f57' }} />
            <span className="size-2 rounded-full" style={{ background: '#febc2e' }} />
            <span className="size-2 rounded-full" style={{ background: '#28c840' }} />
          </div>
          <div
            className="ml-1 flex-1 truncate chamfer-sm px-2 py-1 font-mono text-[0.7rem]"
            style={{ background: 'var(--surface2)', color: 'var(--dirty-grey)' }}
          >
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
              <div
                className="chamfer-card w-full p-4 t-body-md leading-snug"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--dirty-grey)'
                }}
              >
                <p className="t-heading-md text-van-white">
                  {agent
                    ? `No preview URL set for ${agent.displayName}.`
                    : 'No agent assigned to this preview slot.'}
                </p>
                <p className="mt-2 t-body-sm text-dirty-grey">
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
