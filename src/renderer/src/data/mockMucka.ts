import type { MuckaChatMessage, PreviewSlot } from '@shared/types'

export const muckaBannerStatus =
  'Sammy needs a call on the voice timeout — everyone else is heads-down. We’re tracking ahead of Friday cut.'

export const mockMuckaChat: MuckaChatMessage[] = [
  {
    id: 'c1',
    from: 'mucka',
    timestamp: '09:41',
    text: 'Morning Tom. 4 jobs on the board — onboarding, voice fix, Next 16, charts.'
  },
  {
    id: 'c2',
    from: 'tom',
    timestamp: '09:42',
    text: 'Cool. Run them in parallel, keep me out of it unless someone’s stuck.'
  },
  {
    id: 'c3',
    from: 'mucka',
    timestamp: '09:42',
    text: 'On it. I’ll only ping for genuine forks.'
  },
  {
    id: 'c4',
    from: 'mucka',
    timestamp: '10:11',
    text: 'Heads up — Sammy hit a fork on the timeout strategy. Need 30s.'
  }
]

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
