import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'
import { MuckaTextProvider } from './mucka/MuckaTextContext'
import { AgentsProvider } from './state/AgentsContext'
import { AgentStatusProvider } from './state/AgentStatusContext'
import { AttentionNotifier } from './state/AttentionNotifier'
import { EventsProvider } from './state/EventsContext'
import { LayoutProvider } from './state/LayoutContext'
import { NotesProvider } from './state/NotesContext'
import { VercelProvider } from './state/VercelContext'
import { GitHubProvider } from './state/GitHubContext'

function App(): React.JSX.Element {
  return (
    <AgentsProvider>
      <LayoutProvider>
        <AgentStatusProvider>
          <NotesProvider>
            <EventsProvider>
              <VercelProvider>
                <GitHubProvider>
                  <MuckaSessionProvider>
                    <MuckaTextProvider>
                      <AttentionNotifier />
                      <Workstation />
                    </MuckaTextProvider>
                  </MuckaSessionProvider>
                </GitHubProvider>
              </VercelProvider>
            </EventsProvider>
          </NotesProvider>
        </AgentStatusProvider>
      </LayoutProvider>
    </AgentsProvider>
  )
}

export default App
