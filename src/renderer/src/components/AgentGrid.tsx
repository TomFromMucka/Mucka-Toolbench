import { mockAgents } from '../data/mockAgents'
import { AgentClipboard } from './AgentClipboard'

export function AgentGrid(): React.JSX.Element {
  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-3">
      {mockAgents.map((agent) => (
        <AgentClipboard key={agent.id} agent={agent} />
      ))}
    </div>
  )
}
