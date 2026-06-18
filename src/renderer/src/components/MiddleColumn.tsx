import { useState } from 'react'
import { rowForSize, type PanelSize } from './panelSize'
import { useMuckaSession } from '../mucka/MuckaSessionContext'
import { MuckaChat } from './MuckaChat'
import { JobSheet } from './JobSheet'
import { NotesPanel } from './NotesPanel'

type Sizes = [PanelSize, PanelSize, PanelSize]

export function MiddleColumn(): React.JSX.Element {
  // Each section carries its own min/mid/max size, set from its header
  // control; the three tracks reflow against each other via grid weights.
  const [sizes, setSizes] = useState<Sizes>(['mid', 'mid', 'mid'])
  const { pendingConfirm } = useMuckaSession()

  const setAt = (i: 0 | 1 | 2) => (s: PanelSize): void =>
    setSizes((prev) => {
      const next = [...prev] as Sizes
      next[i] = s
      return next
    })

  // The confirm lives inside the chat panel (index 0). If one is waiting
  // while the chat is minimised, bump it up so Tom can see and answer it.
  const effective: Sizes =
    pendingConfirm && sizes[0] === 'min' ? ['mid', sizes[1], sizes[2]] : sizes

  const rows = effective.map(rowForSize).join(' ')

  return (
    <div
      className="grid min-h-0 gap-3"
      style={{ gridTemplateRows: rows, transition: 'grid-template-rows 180ms ease' }}
    >
      <MuckaChat size={effective[0]} onResize={setAt(0)} />
      <JobSheet size={effective[1]} onResize={setAt(1)} />
      <NotesPanel size={effective[2]} onResize={setAt(2)} />
    </div>
  )
}
