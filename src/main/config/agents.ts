import os from 'node:os'
import type { AgentConfig, AgentId } from '@shared/types'
import { getAgent, listAgents, seedMissing } from '../db/agents'

/**
 * Default agent set. Rows are seeded per-id, so a database created before
 * an id was added to this list picks it up on next launch without
 * disturbing the rows the user has already configured.
 */
const HOME = os.homedir()
const SHELL = process.env.SHELL?.includes('zsh') ? process.env.SHELL : '/bin/zsh'

const DEFAULTS: AgentConfig[] = [
  {
    id: 'dave',
    displayName: 'Dave',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: 'http://localhost:3001',
    vercelProjectId: null,
    running: false
  },
  {
    id: 'sammy',
    displayName: 'Sammy',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: null,
    vercelProjectId: null,
    running: false
  },
  {
    id: 'kev',
    displayName: 'Kev',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: null,
    vercelProjectId: null,
    running: false
  },
  {
    id: 'bren',
    displayName: 'Bren',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: 'http://localhost:3002',
    vercelProjectId: null,
    running: false
  },
  {
    id: 'marlene',
    displayName: 'Marlene',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: null,
    vercelProjectId: null,
    running: false
  },
  {
    id: 'albert',
    displayName: 'Albert',
    branch: 'main',
    worktreePath: HOME,
    command: SHELL,
    args: ['-l'],
    needsAttention: false,
    attentionReason: null,
    previewUrl: null,
    vercelProjectId: null,
    running: false
  }
]

let seeded = false

export function ensureSeeded(): void {
  if (seeded) return
  seedMissing(DEFAULTS)
  seeded = true
}

export function getAgentConfigs(): AgentConfig[] {
  ensureSeeded()
  return listAgents()
}

export function getAgentConfig(id: AgentId): AgentConfig | undefined {
  ensureSeeded()
  return getAgent(id)
}
