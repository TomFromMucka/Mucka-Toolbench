import type { Agent } from '@shared/types'

export const mockAgents: Agent[] = [
  {
    id: 'dave',
    displayName: 'Dave',
    branch: 'feat/onboarding-redesign',
    worktreePath: '~/work/mucka-pro-dave',
    status: 'editing',
    needsAttention: false,
    headline: 'Refactoring the onboarding step machine',
    terminalLines: [
      { kind: 'system', text: '─ dave on feat/onboarding-redesign ─' },
      { kind: 'stdout', text: '> Reading src/onboarding/state-machine.ts' },
      { kind: 'stdout', text: '> Found 4 transitions to consolidate.' },
      { kind: 'stdout', text: '> Editing src/onboarding/state-machine.ts' },
      { kind: 'stdout', text: '  + extracted finalisingStep handler' },
      { kind: 'stdout', text: '  + renamed `completeOnboarding` → `finalise`' },
      { kind: 'stdout', text: '> Running pnpm typecheck...' },
      { kind: 'stdout', text: '✓ tsc passed (4.2s)' },
      { kind: 'prompt', text: '◇ next: write tests for the new transitions' }
    ]
  },
  {
    id: 'sammy',
    displayName: 'Sammy',
    branch: 'fix/voice-agent-timeout',
    worktreePath: '~/work/mucka-pro-sammy',
    status: 'awaiting-input',
    needsAttention: true,
    headline: 'Needs you: which timeout value should I use?',
    terminalLines: [
      { kind: 'system', text: '─ sammy on fix/voice-agent-timeout ─' },
      { kind: 'stdout', text: '> Reproduced the timeout bug in tests/voice.spec.ts' },
      { kind: 'stdout', text: '> Two reasonable fixes:' },
      { kind: 'stdout', text: '   (1) bump client timeout from 30s → 45s' },
      { kind: 'stdout', text: '   (2) add server-side keepalive every 10s' },
      { kind: 'stderr', text: '⚠  option (2) needs API changes — flagging for review' },
      { kind: 'prompt', text: '? Tom — which way do you want me to go?' }
    ]
  },
  {
    id: 'kev',
    displayName: 'Kev',
    branch: 'chore/upgrade-next-16',
    worktreePath: '~/work/mucka-pro-kev',
    status: 'running',
    needsAttention: false,
    headline: 'Running the Next 16 codemods',
    terminalLines: [
      { kind: 'system', text: '─ kev on chore/upgrade-next-16 ─' },
      { kind: 'stdout', text: '$ npx @next/codemod@latest upgrade latest' },
      { kind: 'stdout', text: '✓ next-async-request-api  (12 files)' },
      { kind: 'stdout', text: '✓ next-image-experimental (3 files)' },
      { kind: 'stdout', text: '✓ next-link-component   (8 files)' },
      { kind: 'stdout', text: '⠼ running app-dir-runtime-config…' }
    ]
  },
  {
    id: 'bren',
    displayName: 'Bren',
    branch: 'feat/dashboard-charts',
    worktreePath: '~/work/mucka-pro-bren',
    status: 'thinking',
    needsAttention: false,
    headline: 'Planning the chart component API',
    terminalLines: [
      { kind: 'system', text: '─ bren on feat/dashboard-charts ─' },
      { kind: 'stdout', text: '> Reviewing /charts directory…' },
      { kind: 'stdout', text: '> Current state: 3 ad-hoc Recharts wrappers, no shared API' },
      { kind: 'stdout', text: '> Sketching unified <DataChart /> props:' },
      { kind: 'stdout', text: '   - data: Series[]' },
      { kind: 'stdout', text: '   - kind: "line" | "bar" | "area"' },
      { kind: 'stdout', text: '   - axis: { x, y, format? }' },
      { kind: 'prompt', text: '◇ thinking through legend placement…' }
    ]
  }
]
