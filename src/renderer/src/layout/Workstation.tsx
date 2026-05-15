import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentId, AgentUpdate } from '@shared/types'
import { MuckaTopBanner } from '../components/MuckaTopBanner'
import { AgentGrid } from '../components/AgentGrid'
import { ConfirmStrip } from '../components/ConfirmStrip'
import {
  ExplorerPanel,
  EXPLORER_WIDTH_COLLAPSED,
  EXPLORER_WIDTH_EXPANDED
} from '../components/ExplorerPanel'
import { MiddleColumn } from '../components/MiddleColumn'
import { RightColumn } from '../components/RightColumn'
import { SettingsModal } from '../components/SettingsModal'
import { useGitStatus } from '../hooks/useGitStatus'
import { useMuckaSession } from '../mucka/MuckaSessionContext'
import { useAgentsState } from '../state/AgentsContext'

const STORAGE_COLLAPSED = 'explorer.collapsed'
const STORAGE_AGENT = 'explorer.selectedAgent'

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function Workstation(): React.JSX.Element {
  const { agents, reload } = useAgentsState()
  const gitStatus = useGitStatus()
  const { toggle: toggleMucka, restartVersion } = useMuckaSession()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [explorerCollapsed, setExplorerCollapsed] = useState<boolean>(() =>
    readBool(STORAGE_COLLAPSED, false)
  )
  const [explorerAgentId, setExplorerAgentId] = useState<AgentId | null>(() => {
    const stored = readString(STORAGE_AGENT)
    return stored ? (stored as AgentId) : null
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_COLLAPSED, explorerCollapsed ? '1' : '0')
    } catch {
      /* storage disabled */
    }
  }, [explorerCollapsed])

  useEffect(() => {
    if (!explorerAgentId) return
    try {
      localStorage.setItem(STORAGE_AGENT, explorerAgentId)
    } catch {
      /* storage disabled */
    }
  }, [explorerAgentId])

  const resolvedExplorerAgentId = useMemo<AgentId | null>(() => {
    if (explorerAgentId && agents.some((a) => a.id === explorerAgentId)) {
      return explorerAgentId
    }
    return agents[0]?.id ?? null
  }, [agents, explorerAgentId])

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
    <div
      className="flex h-screen w-screen flex-col"
      style={{ background: 'var(--surface2)' }}
    >
      <MuckaTopBanner onOpenSettings={() => setSettingsOpen(true)} />
      <ConfirmStrip />

      <main
        className="grid min-h-0 flex-1 gap-3 px-3 pb-3 pt-2"
        style={{
          gridTemplateColumns: `${
            explorerCollapsed ? EXPLORER_WIDTH_COLLAPSED : EXPLORER_WIDTH_EXPANDED
          } 2fr 1.1fr 1.2fr`,
          transition: 'grid-template-columns 180ms ease'
        }}
      >
        <ExplorerPanel
          agents={agents}
          collapsed={explorerCollapsed}
          onToggle={() => setExplorerCollapsed((v) => !v)}
          selectedAgentId={resolvedExplorerAgentId}
          onSelectAgent={setExplorerAgentId}
        />
        <AgentGrid
          agents={agents}
          gitStatus={gitStatus}
          restartVersion={restartVersion}
        />
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
