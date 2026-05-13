import type { SnagItem } from '@shared/types'

export const mockSnags: SnagItem[] = [
  {
    id: 's1',
    agent: 'dave',
    description: 'tsc warning: unused import in onboarding/index.ts',
    severity: 'warn',
    source: 'typecheck'
  },
  {
    id: 's2',
    agent: 'kev',
    description: 'codemod skipped 2 files needing manual review',
    severity: 'info',
    source: 'build'
  },
  {
    id: 's3',
    agent: 'sammy',
    description: 'voice.spec.ts: 1 failing assertion (timeout case)',
    severity: 'error',
    source: 'test'
  },
  {
    id: 's4',
    agent: 'bren',
    description: 'no-explicit-any in DataChart proposal',
    severity: 'warn',
    source: 'lint'
  },
  {
    id: 's5',
    agent: 'dave',
    description: 'dev server: 200 OK on /onboarding',
    severity: 'info',
    source: 'runtime'
  }
]
