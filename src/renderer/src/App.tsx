import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'
import { AgentsProvider } from './state/AgentsContext'
import { NoticesProvider } from './state/NoticesContext'
import { VercelProvider } from './state/VercelContext'
import { GitHubProvider } from './state/GitHubContext'

function App(): React.JSX.Element {
  return (
    <AgentsProvider>
      <NoticesProvider>
        <VercelProvider>
          <GitHubProvider>
            <MuckaSessionProvider>
              <Workstation />
            </MuckaSessionProvider>
          </GitHubProvider>
        </VercelProvider>
      </NoticesProvider>
    </AgentsProvider>
  )
}

export default App
