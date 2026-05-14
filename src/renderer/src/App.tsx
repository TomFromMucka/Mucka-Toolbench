import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'
import { AgentsProvider } from './state/AgentsContext'
import { EventsProvider } from './state/EventsContext'
import { NotesProvider } from './state/NotesContext'
import { VercelProvider } from './state/VercelContext'
import { GitHubProvider } from './state/GitHubContext'

function App(): React.JSX.Element {
  return (
    <AgentsProvider>
      <NotesProvider>
        <EventsProvider>
          <VercelProvider>
            <GitHubProvider>
              <MuckaSessionProvider>
                <Workstation />
              </MuckaSessionProvider>
            </GitHubProvider>
          </VercelProvider>
        </EventsProvider>
      </NotesProvider>
    </AgentsProvider>
  )
}

export default App
