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
            {/* Outside NeedsYou: an agent with an open PR has work to check. */}
            <GitHubProvider>
              <NeedsYouProvider>
                <NotesProvider>
                  <EventsProvider>
                    <VercelProvider>
                      <MuckaSessionProvider>
                        <MuckaTextProvider>
                          <AttentionNotifier />
                          <Workstation />
                        </MuckaTextProvider>
                      </MuckaSessionProvider>
                    </VercelProvider>
                  </EventsProvider>
                </NotesProvider>
              </NeedsYouProvider>
            </GitHubProvider>
          </JobsProvider>
        </AgentStatusProvider>
      </LayoutProvider>
    </AgentsProvider>
  )
}

export default App
