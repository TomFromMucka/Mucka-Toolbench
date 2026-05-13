/**
 * Cross-process types — usable from main, preload, and renderer.
 * For mock-shell phase only the renderer reads these.
 */

export type AgentId = 'dave' | 'sammy' | 'kev' | 'bren'

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'editing'
  | 'running'
  | 'awaiting-input'
  | 'blocked'
  | 'done'

export interface Agent {
  id: AgentId
  displayName: string
  branch: string
  worktreePath: string
  status: AgentStatus
  /** When true, the clipboard glows orange — the agent needs Tom. */
  needsAttention: boolean
  /** Latest one-liner from the agent — shown beneath the clip header. */
  headline: string
  /** Mock terminal lines; replace with PTY stream in the next session. */
  terminalLines: TerminalLine[]
}

export interface TerminalLine {
  kind: 'stdout' | 'stderr' | 'prompt' | 'system'
  text: string
}

export interface JobSheetEntry {
  id: string
  timestamp: string
  agent: AgentId | 'mucka' | 'system'
  message: string
  tone?: 'normal' | 'attention' | 'win'
}

export interface NoticeBoardItem {
  id: string
  title: string
  body: string
  pinned?: boolean
  colour?: 'cream' | 'yellow' | 'pink' | 'blue'
}

export interface SnagItem {
  id: string
  agent: AgentId
  description: string
  severity: 'info' | 'warn' | 'error'
  source: 'typecheck' | 'lint' | 'test' | 'build' | 'runtime'
}

export interface MuckaChatMessage {
  id: string
  from: 'mucka' | 'tom'
  timestamp: string
  text: string
}

export interface PreviewSlot {
  id: 'left' | 'right'
  agentId: AgentId | null
  url: string | null
  /** Mock screenshot description or status — shown when iframe is empty. */
  placeholder: string
}
