import { useMemo } from 'react'
import { useAgentsState } from '../state/AgentsContext'
import { useAgentStatuses } from '../state/AgentStatusContext'

/**
 * Names the agents waiting on Tom, in the top banner.
 *
 * The per-panel glow is the precise signal but it's easy to miss on a
 * 3840px screen with six terminals — this is the one place he's always
 * looking. Deliberately silent when nobody needs anything, so it reads as
 * a real alert rather than furniture.
 */
export function AttentionRollCall(): React.JSX.Element | null {
  const { agents } = useAgentsState()
  const { statusFor } = useAgentStatuses()

  const waiting = useMemo(
    () =>
      agents.filter(
        (a) =>
          a.running &&
          (a.needsAttention || statusFor(a.id) === 'awaiting-input')
      ),
    [agents, statusFor]
  )

  if (waiting.length === 0) return null

  return (
    <div
      className="chamfer-sm flex shrink-0 items-center gap-2 px-2.5 py-1"
      style={{
        background: 'rgba(255, 78, 0, 0.16)',
        boxShadow: 'inset 0 0 0 1px rgba(255, 78, 0, 0.55)'
      }}
      title={`Waiting on you: ${waiting.map((a) => a.displayName).join(', ')}`}
    >
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ background: 'var(--orange)' }}
      />
      <span
        className="text-[0.68rem] uppercase tracking-[0.16em]"
        style={{ color: 'var(--orange)' }}
      >
        waiting
      </span>
      <span
        className="max-w-[22rem] truncate text-[0.8rem]"
        style={{ color: 'var(--van-white)' }}
      >
        {waiting.map((a) => a.displayName).join(' · ')}
      </span>
    </div>
  )
}
