import { mockPreviews } from '../data/mockMucka'
import { BrowserPreview } from './BrowserPreview'
import { SnaggingPanel } from './SnaggingPanel'

export function RightColumn(): React.JSX.Element {
  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)' }}
    >
      <BrowserPreview slot={mockPreviews[0]!} />
      <BrowserPreview slot={mockPreviews[1]!} />
      <SnaggingPanel />
    </div>
  )
}
