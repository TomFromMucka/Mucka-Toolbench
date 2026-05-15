import { useCallback, useRef, useState } from 'react'
import clsx from 'clsx'
import { Play, Power } from 'lucide-react'
import type { AgentConfig, TerminalId } from '@shared/types'
import { useAgentsState } from '../state/AgentsContext'
import { AgentTerminal } from './AgentTerminal'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

interface AgentTerminalPanelProps {
  agent: AgentConfig
}

interface TerminalTab {
  terminalId: TerminalId
  label: string
  isPreviewSource: boolean
  /** One-shot command typed into the PTY after spawn (set by the preview button). */
  autoCommand?: string
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s\x1b),.;'"`]*)?/gi
const URL_BUFFER_BYTES = 4096

const PREVIEW_COMMAND = 'npm run dev'

function primaryLabel(agent: AgentConfig): string {
  const tail = agent.command.split('/').pop() ?? agent.command
  return tail || 'shell'
}

function findLatestLocalhostUrl(buffer: string): string | null {
  const matches = buffer.match(URL_RE)
  if (!matches || matches.length === 0) return null
  return matches[matches.length - 1] ?? null
}

export function AgentTerminalPanel({
  agent
}: AgentTerminalPanelProps): React.JSX.Element {
  const { reload } = useAgentsState()
  if (!agent.running) {
    return <AgentIdleScreen agent={agent} />
  }
  return <RunningAgentPanel agent={agent} reload={reload} />
}

function AgentIdleScreen({
  agent
}: {
  agent: AgentConfig
}): React.JSX.Element {
  const { reload } = useAgentsState()
  const [starting, setStarting] = useState(false)
  const handleStart = useCallback(async () => {
    if (starting) return
    setStarting(true)
    try {
      await window.mucka.startAgent(agent.id)
      await reload()
    } finally {
      setStarting(false)
    }
  }, [agent.id, reload, starting])

  const cmdLabel =
    `${primaryLabel(agent)}${agent.args.length > 0 ? ' ' + agent.args.join(' ') : ''}`

  return (
    <div
      className="grid h-full place-items-center px-6"
      style={{ background: 'var(--surface2)' }}
    >
      <div className="flex max-w-[26rem] flex-col items-center gap-3 text-center">
        <p className="t-label-sm text-dirty-grey">Agent is stopped</p>
        <p className="t-body-sm text-dirty-grey">
          will run{' '}
          <span
            className="font-mono"
            style={{ color: 'var(--van-white)' }}
          >
            {cmdLabel}
          </span>{' '}
          in{' '}
          <span
            className="font-mono"
            style={{ color: 'var(--van-white)' }}
          >
            {agent.worktreePath}
          </span>
        </p>
        <Button
          variant="primary"
          size="md"
          leadingIcon={Play}
          trailingIcon={null}
          onClick={() => void handleStart()}
          disabled={starting}
        >
          {starting ? 'Starting…' : 'Start agent'}
        </Button>
      </div>
    </div>
  )
}

function RunningAgentPanel({
  agent,
  reload
}: {
  agent: AgentConfig
  reload: () => Promise<void>
}): React.JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    { terminalId: agent.id, label: primaryLabel(agent), isPreviewSource: false }
  ])
  const [activeId, setActiveId] = useState<TerminalId>(agent.id)
  const counterRef = useRef(1)
  const detectionBufferRef = useRef('')
  const lastPushedUrlRef = useRef<string | null>(null)
  const [stopping, setStopping] = useState(false)

  const handleStop = useCallback(async (): Promise<void> => {
    if (stopping) return
    setStopping(true)
    try {
      await window.mucka.stopAgent(agent.id)
      await reload()
    } finally {
      setStopping(false)
    }
  }, [agent.id, reload, stopping])

  const clearPreviewUrl = useCallback((): void => {
    void window.mucka
      .updateAgent({ id: agent.id, previewUrl: null })
      .then(() => reload())
      .catch(() => {
        /* harmless — the user can clear it manually in Settings */
      })
  }, [agent.id, reload])

  const addTab = useCallback((): void => {
    counterRef.current += 1
    const n = counterRef.current
    const terminalId = `${agent.id}:t${n}`
    setTabs((prev) => [
      ...prev,
      { terminalId, label: `${primaryLabel(agent)} ${n}`, isPreviewSource: false }
    ])
    setActiveId(terminalId)
  }, [agent])

  const startPreview = useCallback((): void => {
    counterRef.current += 1
    const n = counterRef.current
    const terminalId = `${agent.id}:t${n}`

    setTabs((prev) => {
      const existing = prev.find((t) => t.isPreviewSource)
      if (existing) {
        void window.mucka.killPty(existing.terminalId)
      }
      const withoutOld = prev.filter((t) => !t.isPreviewSource)
      return [
        ...withoutOld,
        {
          terminalId,
          label: 'preview',
          isPreviewSource: true,
          autoCommand: PREVIEW_COMMAND
        }
      ]
    })
    setActiveId(terminalId)
    detectionBufferRef.current = ''
    lastPushedUrlRef.current = null
    // Old URL is stale until the new server prints its own — clear so the
    // iframe falls back to the placeholder during the transition.
    clearPreviewUrl()
  }, [agent.id, clearPreviewUrl])

  const closeTab = useCallback(
    (terminalId: TerminalId): void => {
      if (terminalId === agent.id) return
      let wasPreviewSource = false
      setTabs((prev) => {
        wasPreviewSource =
          prev.find((t) => t.terminalId === terminalId)?.isPreviewSource ?? false
        return prev.filter((t) => t.terminalId !== terminalId)
      })
      setActiveId((current) => (current === terminalId ? agent.id : current))
      void window.mucka.killPty(terminalId)
      if (wasPreviewSource) {
        detectionBufferRef.current = ''
        lastPushedUrlRef.current = null
        clearPreviewUrl()
      }
    },
    [agent.id, clearPreviewUrl]
  )

  const handlePreviewSourceData = useCallback(
    (chunk: string): void => {
      const clean = chunk.replace(ANSI_RE, '')
      const merged = detectionBufferRef.current + clean
      detectionBufferRef.current =
        merged.length > URL_BUFFER_BYTES
          ? merged.slice(merged.length - URL_BUFFER_BYTES)
          : merged

      const found = findLatestLocalhostUrl(detectionBufferRef.current)
      if (!found || found === lastPushedUrlRef.current) return
      lastPushedUrlRef.current = found
      void window.mucka
        .updateAgent({ id: agent.id, previewUrl: found })
        .then(() => reload())
        .catch(() => {
          /* leave the previous URL — let user retry */
        })
    },
    [agent.id, reload]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex items-stretch gap-px overflow-x-auto border-b px-1 py-1"
        style={{
          background: 'var(--charcoal)',
          borderColor: 'var(--border)',
          color: 'rgba(234, 233, 232, 0.85)'
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.terminalId === activeId
          const isPrimary = tab.terminalId === agent.id
          return (
            <div
              key={tab.terminalId}
              className={clsx(
                'group t-label-sm flex items-center gap-1 chamfer-sm px-1.5 py-0.5',
                isActive
                  ? 'shadow-[inset_0_-2px_0_var(--orange)]'
                  : 'opacity-60 hover:opacity-100',
                tab.isPreviewSource && !isActive && 'text-orange'
              )}
              style={{
                background: isActive ? 'var(--surface2)' : 'transparent',
                color:
                  tab.isPreviewSource && !isActive
                    ? 'var(--orange)'
                    : 'var(--van-white)'
              }}
            >
              <button
                type="button"
                onClick={() => setActiveId(tab.terminalId)}
                className="flex items-center gap-1.5"
                title={
                  tab.isPreviewSource
                    ? 'Preview terminal — its localhost URL is bound to the iframe'
                    : isPrimary
                      ? 'Primary terminal'
                      : 'Sub-terminal'
                }
              >
                <span className="font-mono text-[0.7rem]">
                  {tab.isPreviewSource ? '◉' : '>_'}
                </span>
                <span>{tab.label}</span>
              </button>
              {!isPrimary ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.terminalId)
                  }}
                  title={
                    tab.isPreviewSource
                      ? 'Stop the preview — kills this terminal and clears the iframe'
                      : 'Close this sub-terminal'
                  }
                  className="grid size-4 place-items-center text-[0.8rem] leading-none hover:bg-van-white/15"
                >
                  ×
                </button>
              ) : null}
            </div>
          )
        })}

        <button
          type="button"
          onClick={addTab}
          title="New shell — split this agent's worktree into another tab"
          className="chamfer-sm ml-1 grid size-6 place-items-center text-[1rem] leading-none hover:bg-van-white/15"
          style={{ color: 'var(--van-white)' }}
        >
          +
        </button>
        <button
          type="button"
          onClick={startPreview}
          title={`Fresh preview — runs \`${PREVIEW_COMMAND}\` in a new tab and binds its localhost URL to the iframe`}
          className="chamfer-sm ml-1 t-label-sm flex items-center gap-1 px-1.5 py-0.5"
          style={{
            background: 'rgba(255, 78, 0, 0.18)',
            color: 'var(--orange)'
          }}
        >
          <span className="font-mono text-[0.7rem]">▶</span>
          <span>preview</span>
        </button>
        <button
          type="button"
          onClick={() => void handleStop()}
          disabled={stopping}
          title="Stop this agent — kills the primary shell and all sub-terminals"
          className={clsx(
            'chamfer-sm ml-auto t-label-sm flex items-center gap-1 px-1.5 py-0.5',
            stopping && 'opacity-50'
          )}
          style={{
            background: 'rgba(234, 233, 232, 0.08)',
            color: 'var(--van-white)'
          }}
        >
          <Icon icon={Power} size={12} />
          <span>{stopping ? 'stopping…' : 'stop'}</span>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const isActive = tab.terminalId === activeId
          return (
            <div
              key={tab.terminalId}
              className={clsx(
                'absolute inset-0 p-1',
                isActive ? 'block' : 'hidden'
              )}
            >
              <AgentTerminal
                terminalId={tab.terminalId}
                agentId={agent.id}
                isActive={isActive}
                autoCommand={tab.autoCommand}
                onData={tab.isPreviewSource ? handlePreviewSourceData : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
