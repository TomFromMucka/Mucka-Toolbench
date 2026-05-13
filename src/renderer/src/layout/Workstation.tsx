import { useCallback, useEffect, useState } from 'react'
import type { AgentUpdate } from '@shared/types'
import { MuckaTopBanner } from '../components/MuckaTopBanner'
import { AgentGrid } from '../components/AgentGrid'
import { MiddleColumn } from '../components/MiddleColumn'
import { RightColumn } from '../components/RightColumn'
import { SettingsModal } from '../components/SettingsModal'
import { useAgents } from '../hooks/useAgents'
import { useGitStatus } from '../hooks/useGitStatus'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

export function Workstation(): React.JSX.Element {
  const { agents, reload } = useAgents()
  const gitStatus = useGitStatus()
  const { toggle: toggleMucka } = useMuckaSession()
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (mod && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        toggleMucka()
      } else if (e.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, toggleMucka])

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
