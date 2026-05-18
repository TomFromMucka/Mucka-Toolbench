import type { AgentId } from '@shared/types'
import type { BrowserSlotId } from '@shared/browser'

/**
 * Routing for "send this URL into a browser pane" requests fired by
 * AgentTerminal's ⌘-click handler.
 *
 * Each mounted TabbedBrowserPane registers its slotId + the AgentId
 * currently bound to that slot. When AgentTerminal asks the bus to
 * route, we pick the slot whose agent matches; if none matches we fall
 * back to the left slot, then the right. The chosen slot opens a new
 * tab via main and switches to it.
 */

export type PreviewSlotId = BrowserSlotId

interface Registration {
  agentId: AgentId | null
}

const slots = new Map<PreviewSlotId, Registration>()

export function registerPreviewSlot(
  slotId: PreviewSlotId,
  agentId: AgentId | null
): () => void {
  const entry: Registration = { agentId }
  slots.set(slotId, entry)
  return () => {
    const cur = slots.get(slotId)
    if (cur === entry) slots.delete(slotId)
  }
}

function pickSlot(fromAgent: AgentId): PreviewSlotId | null {
  for (const [slotId, slot] of slots) {
    if (slot.agentId === fromAgent) return slotId
  }
  if (slots.has('left')) return 'left'
  if (slots.has('right')) return 'right'
  return null
}

export function requestPreviewNavigation(input: {
  url: string
  fromAgent: AgentId
}): boolean {
  const slotId = pickSlot(input.fromAgent)
  if (!slotId) return false
  void window.mucka.openBrowserTab({ slotId, url: input.url })
  return true
}
