import { useAgentsState } from '../state/AgentsContext'
import { BrowserPreview } from './BrowserPreview'
import { VercelPanel } from './VercelPanel'
import { GitPanel } from './GitPanel'

export function RightColumn(): React.JSX.Element {
  const { agents } = useAgentsState()
  const withPreview = agents.filter((a) => a.previewUrl && a.previewUrl.trim() !== '')
  const leftAgent = withPreview[0] ?? null
  const rightAgent = withPreview[1] ?? null

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)' }}
    >
      <BrowserPreview slotId="left" agent={leftAgent} />
      <BrowserPreview slotId="right" agent={rightAgent} />
      <div className="grid min-h-0 grid-cols-2 gap-3">
        <VercelPanel />
        <GitPanel />
      </div>
    </div>
  )
}
