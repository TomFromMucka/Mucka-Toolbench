import { useAgentsState } from '../state/AgentsContext'
import { TabbedBrowserPane, useBrowserTabs } from './TabbedBrowserPane'
import { VercelPanel } from './VercelPanel'
import { GitPanel } from './GitPanel'

export function RightColumn(): React.JSX.Element {
  const { agents } = useAgentsState()
  const withPreview = agents.filter((a) => a.previewUrl && a.previewUrl.trim() !== '')
  const leftAgent = withPreview[0] ?? null
  const rightAgent = withPreview[1] ?? null
  const tabs = useBrowserTabs()

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)' }}
    >
      <TabbedBrowserPane slotId="left" agent={leftAgent} allTabs={tabs} />
      <TabbedBrowserPane slotId="right" agent={rightAgent} allTabs={tabs} />
      <div className="grid min-h-0 grid-cols-2 gap-3">
        <VercelPanel />
        <GitPanel />
      </div>
    </div>
  )
}
