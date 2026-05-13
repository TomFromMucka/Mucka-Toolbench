import { Workstation } from './layout/Workstation'
import { MuckaSessionProvider } from './mucka/MuckaSessionContext'

function App(): React.JSX.Element {
  return (
    <MuckaSessionProvider>
      <Workstation />
    </MuckaSessionProvider>
  )
}

export default App
