import type { JobSheetEntry } from '@shared/types'

export const mockJobSheet: JobSheetEntry[] = [
  {
    id: 'j1',
    timestamp: '09:42',
    agent: 'mucka',
    message: 'Morning — kicking Dave off on the onboarding refactor.',
    tone: 'normal'
  },
  {
    id: 'j2',
    timestamp: '09:43',
    agent: 'dave',
    message: 'Worktree pulled. Reading state machine.',
    tone: 'normal'
  },
  {
    id: 'j3',
    timestamp: '09:51',
    agent: 'sammy',
    message: 'Reproduced the voice-agent timeout in tests/voice.spec.ts',
    tone: 'normal'
  },
  {
    id: 'j4',
    timestamp: '09:55',
    agent: 'kev',
    message: 'Started Next 16 upgrade — running codemods.',
    tone: 'normal'
  },
  {
    id: 'j5',
    timestamp: '10:02',
    agent: 'bren',
    message: 'Picked up chart unification — investigating current usage.',
    tone: 'normal'
  },
  {
    id: 'j6',
    timestamp: '10:08',
    agent: 'dave',
    message: 'tsc green on onboarding refactor. Moving to tests.',
    tone: 'win'
  },
  {
    id: 'j7',
    timestamp: '10:11',
    agent: 'sammy',
    message: 'Stuck — two timeout strategies, need a call from Tom.',
    tone: 'attention'
  },
  {
    id: 'j8',
    timestamp: '10:14',
    agent: 'mucka',
    message: 'Flagged Sammy. Bren is mid-plan, not blocking.',
    tone: 'normal'
  }
]
