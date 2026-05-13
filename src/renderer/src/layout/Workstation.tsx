import { MuckaTopBanner } from '../components/MuckaTopBanner'
import { AgentGrid } from '../components/AgentGrid'
import { MiddleColumn } from '../components/MiddleColumn'
import { RightColumn } from '../components/RightColumn'

export function Workstation(): React.JSX.Element {
  return (
    <div className="wood-grain flex h-screen w-screen flex-col">
      <MuckaTopBanner />

      {/* 2 : 1.1 : 1.2 fractional split — matches the brief for 3840×1200 */}
      <main
        className="grid min-h-0 flex-1 gap-3 px-3 pb-3 pt-2"
        style={{ gridTemplateColumns: '2fr 1.1fr 1.2fr' }}
      >
        <AgentGrid />
        <MiddleColumn />
        <RightColumn />
      </main>
    </div>
  )
}
