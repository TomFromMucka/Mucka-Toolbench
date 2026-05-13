import type { PreviewSlot } from '@shared/types'

export const mockPreviews: PreviewSlot[] = [
  {
    id: 'left',
    agentId: 'dave',
    url: null,
    placeholder:
      'dave · http://localhost:3001 · /onboarding\nrendered: <OnboardingShell> step "verify-email"'
  },
  {
    id: 'right',
    agentId: 'bren',
    url: null,
    placeholder:
      'bren · http://localhost:3002 · /dashboard\nrendered: <DataChart kind="bar"> · 12 series'
  }
]
