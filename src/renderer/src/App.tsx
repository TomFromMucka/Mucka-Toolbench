import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'
import { MuckaTextProvider } from './mucka/MuckaTextContext'
import { AgentsProvider } from './state/AgentsContext'
import { AgentStatusProvider } from './state/AgentStatusContext'
import { AttentionNotifier } from './state/AttentionNotifier'
import { EventsProvider } from './state/EventsContext'
import { LayoutProvider } from './state/LayoutContext'
import { NotesProvider } from './state/NotesContext'
import { NeedsYouProvider } from './state/NeedsYouContext'
import { JobsProvider } from './state/JobsContext'
import { VercelProvider } from './state/VercelContext'
import { GitHubProvider } from './state/GitHubContext'

function App(): React.JSX.Element {
  return (
    <AgentsProvider>
      <LayoutProvider>
        <AgentStatusProvider>
          <JobsProvider>
            <NeedsYouProvider>
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
            </NeedsYouProvider>
          </JobsProvider>
        </AgentStatusProvider>
      </LayoutProvider>
    </AgentsProvider>
  )
}

export default App
