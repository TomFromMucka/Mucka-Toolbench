import { useCallback, useEffect, useState } from 'react'
import type { AgentUpdate } from '@shared/types'
import { MuckaTopBanner } from '../components/MuckaTopBanner'
import { AgentGrid } from '../components/AgentGrid'
import { MiddleColumn } from '../components/MiddleColumn'
import { RightColumn } from '../components/RightColumn'
import { SettingsModal } from '../components/SettingsModal'
import { useAgents } from '../hooks/useAgents'
import { useGitStatus } from '../hooks/useGitStatus'

export function Workstation(): React.JSX.Element {
  const { agents, reload } = useAgents()
  const gitStatus = useGitStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Cmd+, opens settings (mac convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (e.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  const handleSave = useCallback(
    async (patch: AgentUpdate) => {
      await window.mucka.updateAgent(patch)
      await reload()
    },
    [reload]
  )

  return (
    <div className="wood-grain flex h-screen w-screen flex-col">
      <MuckaTopBanner onOpenSettings={() => setSettingsOpen(true)} />

      <main
        className="grid min-h-0 flex-1 gap-3 px-3 pb-3 pt-2"
        style={{ gridTemplateColumns: '2fr 1.1fr 1.2fr' }}
      >
        <AgentGrid agents={agents} gitStatus={gitStatus} />
        <MiddleColumn />
        <RightColumn />
      </main>

      <SettingsModal
        open={settingsOpen}
        agents={agents}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSave}
      />
    </div>
  )
}
