import { MuckaChat } from './MuckaChat'
import { JobSheet } from './JobSheet'
import { NoticeBoard } from './NoticeBoard'

export function MiddleColumn(): React.JSX.Element {
  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: 'minmax(0, 0.85fr) minmax(0, 1.4fr) minmax(0, 1fr)' }}
    >
      <MuckaChat />
      <JobSheet />
      <NoticeBoard />
    </div>
  )
}
