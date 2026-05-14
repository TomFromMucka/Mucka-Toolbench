import os from 'node:os'
import type { AgentConfig, AgentId } from '@shared/types'
import { getAgent, listAgents, seedIfEmpty } from '../db/agents'

/**
 * Default agent set used only on first launch (seeded into sqlite once,
 * then user edits via the Settings sheet).
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
    vercelProjectId: null
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
    vercelProjectId: null
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
    vercelProjectId: null
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
    vercelProjectId: null
  }
]

let seeded = false

export function ensureSeeded(): void {
  if (seeded) return
  seedIfEmpty(DEFAULTS)
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
