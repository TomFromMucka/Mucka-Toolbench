import os from 'node:os'
import fs from 'node:fs'
import type { AgentConfig } from '@shared/types'

/**
 * The four worktree agents.
 *
 * Today: zsh in $HOME for all four — proves the PTY plumbing works.
 * Next session: this list moves into sqlite and the user edits it via the UI.
 * Until then, edit the array below to point each agent at a real worktree
 * and change `command` from "zsh" to "claude" when you're ready.
 */
const HOME = os.homedir()

const SHELL = process.env.SHELL?.includes('zsh')
  ? process.env.SHELL
  : '/bin/zsh'

function existingDirOrHome(path: string): string {
  try {
    if (fs.statSync(path).isDirectory()) return path
  } catch {
    /* fall through */
  }
  return HOME
}

const AGENTS: AgentConfig[] = [
  {
    id: 'dave',
    displayName: 'Dave',
    branch: 'feat/onboarding-redesign',
    worktreePath: existingDirOrHome(`${HOME}/work/mucka-pro-dave`),
    command: SHELL,
    args: ['-l']
  },
  {
    id: 'sammy',
    displayName: 'Sammy',
    branch: 'fix/voice-agent-timeout',
    worktreePath: existingDirOrHome(`${HOME}/work/mucka-pro-sammy`),
    command: SHELL,
    args: ['-l']
  },
  {
    id: 'kev',
    displayName: 'Kev',
    branch: 'chore/upgrade-next-16',
    worktreePath: existingDirOrHome(`${HOME}/work/mucka-pro-kev`),
    command: SHELL,
    args: ['-l']
  },
  {
    id: 'bren',
    displayName: 'Bren',
    branch: 'feat/dashboard-charts',
    worktreePath: existingDirOrHome(`${HOME}/work/mucka-pro-bren`),
    command: SHELL,
    args: ['-l']
  }
]

export function getAgentConfigs(): AgentConfig[] {
  return AGENTS
}

export function getAgentConfig(id: AgentConfig['id']): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id)
}
