import type { AgentId } from '@shared/types'

/**
 * Renderer-only routing layer for "send this URL into a preview pane"
 * requests fired by AgentTerminal's ⌘-click handler.
 *
 * Each mounted BrowserPreview registers its slotId, the AgentId
 * currently attached to it, and a navigator function that swaps the
 * iframe src + flips to a desktop viewport preset.
 *
 * `requestPreviewNavigation` picks the best target:
 *   1. the slot whose agent matches `fromAgent` (preferred — feels
 *      natural when Dave's preview shows Dave's dev server already);
 *   2. otherwise the LEFT slot;
 *   3. otherwise the right slot.
 *
 * Returns false if no slot is currently registered — callers can fall
 * back to opening in the system browser.
 */

export type PreviewSlotId = 'left' | 'right'

type Navigator = (url: string) => void

interface Registration {
  agentId: AgentId | null
  nav: Navigator
}

const slots = new Map<PreviewSlotId, Registration>()

export function registerPreviewSlot(
  slotId: PreviewSlotId,
  agentId: AgentId | null,
  nav: Navigator
): () => void {
  const entry: Registration = { agentId, nav }
  slots.set(slotId, entry)
  return () => {
    const cur = slots.get(slotId)
    if (cur === entry) slots.delete(slotId)
  }
}

export function requestPreviewNavigation(input: {
  url: string
  fromAgent: AgentId
}): boolean {
  for (const [, slot] of slots) {
    if (slot.agentId === input.fromAgent) {
      slot.nav(input.url)
      return true
    }
  }
  const left = slots.get('left')
  if (left) {
    left.nav(input.url)
    return true
  }
  const right = slots.get('right')
  if (right) {
    right.nav(input.url)
    return true
  }
  return false
}
