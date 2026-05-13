import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'
import { AgentsProvider } from './state/AgentsContext'
import { NoticesProvider } from './state/NoticesContext'

function App(): React.JSX.Element {
  return (
    <AgentsProvider>
      <NoticesProvider>
        <MuckaSessionProvider>
          <Workstation />
        </MuckaSessionProvider>
      </NoticesProvider>
    </AgentsProvider>
  )
}

export default App
