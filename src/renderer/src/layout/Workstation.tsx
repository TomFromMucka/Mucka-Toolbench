import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId, AgentUpdate } from '@shared/types'
import { MuckaTopBanner } from '../components/MuckaTopBanner'
import { AgentGrid } from '../components/AgentGrid'
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
import { useLayout, useVisibleAgents } from '../state/LayoutContext'
import { useNeedsYou } from '../state/NeedsYouContext'
import { JobsLayout } from './JobsLayout'
import { useJobs } from '../state/JobsContext'

const STORAGE_COLLAPSED = 'explorer.collapsed'
const STORAGE_AGENT = 'explorer.selectedAgent'
const STORAGE_JOB = 'jobs.selected'

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
  const { reload } = useAgentsState()
  const agents = useVisibleAgents()
  const { showRightColumn, isJobs } = useLayout()
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

  const { queue, focusTerminal } = useNeedsYou()

  const { jobs } = useJobs()
  const [jobPick, setJobPick] = useState<string | null>(() => readString(STORAGE_JOB))
  // What's on screen in Jobs: Tom's pick while it still exists (a job or
  // an agent), otherwise whoever needs him first, then the newest job,
  // then the first agent that's running.
  const currentWork = useMemo<string | null>(
    () =>
      jobs.find((j) => j.id === jobPick)?.id ??
      agents.find((a) => a.id === jobPick)?.id ??
      queue[0]?.agentId ??
      jobs[jobs.length - 1]?.id ??
      agents.find((a) => a.running)?.id ??
      agents[0]?.id ??
      null,
    [agents, jobs, jobPick, queue]
  )
  const currentJobRecord = jobs.find((j) => j.id === currentWork) ?? null
  const currentAgentId = agents.find((a) => a.id === currentWork)?.id ?? null
  const selectWork = useCallback((id: string): void => {
    setJobPick(id)
    try {
      localStorage.setItem(STORAGE_JOB, id)
    } catch {
      /* storage disabled */
    }
  }, [])
  const lastJumpRef = useRef<AgentId | null>(null)

  // ⌘J walks the queue. Answering an agent drops it out, so repeated
  // presses work through the blocked ones; an agent that's only waiting
  // for its next prompt stays put, so step past whoever we jumped to last.
  const jumpToNext = useCallback((): void => {
    if (queue.length === 0) return
    const last = queue.findIndex((e) => e.agentId === lastJumpRef.current)
    const next = queue[(last + 1) % queue.length]
    lastJumpRef.current = next.agentId
    focusTerminal(next.terminalId ?? next.agentId)
  }, [queue, focusTerminal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        jumpToNext()
      } else if (isJobs && mod && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        window.dispatchEvent(new Event('mucka:new-job'))
      } else if (mod && e.key === ',') {
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
  }, [settingsOpen, toggleMucka, jumpToNext, isJobs])

  const handleSave = useCallback(
    async (patch: AgentUpdate) => {
      await window.mucka.updateAgent(patch)
      await reload()
    },
    [reload]
  )

  return (
    <div className="flex h-screen w-screen flex-col" style={{ background: 'var(--surface2)' }}>
      <MuckaTopBanner onOpenSettings={() => setSettingsOpen(true)} />

      <main
        className="grid min-h-0 flex-1 gap-3 px-3 pb-3 pt-2"
        style={{
          gridTemplateColumns: `${
            explorerCollapsed ? EXPLORER_WIDTH_COLLAPSED : EXPLORER_WIDTH_EXPANDED
          } ${
            isJobs ? '1fr 1.8fr 1.5fr 1.1fr' : showRightColumn ? '2fr 1.1fr 1.2fr' : '3.2fr 1.1fr'
          }`,
          transition: 'grid-template-columns 180ms ease'
        }}
      >
        <ExplorerPanel
          agents={agents}
          collapsed={explorerCollapsed}
          onToggle={() => setExplorerCollapsed((v) => !v)}
          // In Jobs the explorer shows the job on screen, and picking an
          // agent there brings its job up.
          selectedAgentId={
            isJobs ? (currentAgentId ?? resolvedExplorerAgentId) : resolvedExplorerAgentId
          }
          onSelectAgent={isJobs ? selectWork : setExplorerAgentId}
          job={isJobs ? currentJobRecord : null}
        />
        {isJobs ? (
          <JobsLayout
            agents={agents}
            gitStatus={gitStatus}
            restartVersion={restartVersion}
            selected={currentWork}
            onSelect={selectWork}
          />
        ) : (
          <AgentGrid agents={agents} gitStatus={gitStatus} restartVersion={restartVersion} />
        )}
        <MiddleColumn />
        {showRightColumn ? <RightColumn /> : null}
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
