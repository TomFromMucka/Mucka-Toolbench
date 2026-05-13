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

/* ─── PTY IPC contract ───────────────────────────────────────────────── */

/**
 * Stable agent config — defines what command runs in each clipboard.
 * Loaded from src/main/config/agents.ts today; will move to sqlite next session.
 */
export interface AgentConfig {
  id: AgentId
  displayName: string
  branch: string
  worktreePath: string
  /** Command to launch inside the worktree (e.g. "zsh", "claude"). */
  command: string
  args: string[]
  /** When true, the clipboard glows brand orange — Tom's attention needed. */
  needsAttention: boolean
  /** Optional one-liner Mucka sets when flagging attention. */
  attentionReason: string | null
}

/** Renderer → main: start a PTY for an agent at the agent's configured cwd. */
export interface PtySpawnRequest {
  agentId: AgentId
  cols: number
  rows: number
}

/** Main → renderer: a chunk of terminal output. */
export interface PtyDataEvent {
  agentId: AgentId
  data: string
}

/** Main → renderer: the PTY process exited. */
export interface PtyExitEvent {
  agentId: AgentId
  exitCode: number
  signal: number | null
}

/** Renderer → main: forward user input to the PTY's stdin. */
export interface PtyWriteRequest {
  agentId: AgentId
  data: string
}

/** Renderer → main: PTY size changed (xterm fit-addon). */
export interface PtyResizeRequest {
  agentId: AgentId
  cols: number
  rows: number
}

/** Patch shape for agent updates (Settings sheet + Mucka tools). */
export type AgentUpdate = Partial<
  Pick<
    AgentConfig,
    | 'displayName'
    | 'branch'
    | 'worktreePath'
    | 'command'
    | 'args'
    | 'needsAttention'
    | 'attentionReason'
  >
> & { id: AgentId }

export type NoticeColour = 'cream' | 'yellow' | 'pink' | 'blue'

export interface Notice {
  id: string
  title: string
  body: string
  colour: NoticeColour
  pinned: boolean
  createdAt: number
}

export interface NoticeInput {
  title: string
  body: string
  colour?: NoticeColour
  pinned?: boolean
}

/** Live git state for an agent's worktree. */
export interface GitStatus {
  /** True when the configured worktreePath exists and is inside a git repo. */
  isRepo: boolean
  /** Branch name, e.g. "main" or "feat/onboarding". Null when detached or unknown. */
  branch: string | null
  /** Short SHA when HEAD is detached. */
  detachedAt: string | null
  /** Has an upstream configured (e.g. origin/main). */
  hasUpstream: boolean
  ahead: number
  behind: number
  /** Files modified in the working tree (not staged). */
  modified: number
  /** Files staged for commit. */
  staged: number
  /** Untracked files. */
  untracked: number
  /** Conflicted files (UU/AA/etc). */
  conflicted: number
  /** Last poll timestamp in ms. */
  checkedAt: number
  /** When isRepo is false, optional reason for display (e.g. "path missing"). */
  reason?: string
}

export interface GitStatusEvent {
  agentId: AgentId
  status: GitStatus
}

/* ─── Mucka PM agent ─────────────────────────────────────────────────── */

export type MuckaStatus =
  | { kind: 'ok' }
  | { kind: 'missing-key' }
  | { kind: 'missing-agent' }
  | { kind: 'error'; message: string }

export type MuckaSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error'

/** What `getMicAccess` reports about the OS-level mic permission (macOS TCC). */
export type MicAccess = 'granted' | 'denied' | 'not-determined' | 'unknown'

/** Shape exposed on window.mucka (see preload). */
export interface MuckaApi {
  listAgents(): Promise<AgentConfig[]>
  updateAgent(patch: AgentUpdate): Promise<AgentConfig>
  pickDirectory(opts?: { defaultPath?: string }): Promise<string | null>
  spawnPty(req: PtySpawnRequest): Promise<void>
  writePty(req: PtyWriteRequest): void
  resizePty(req: PtyResizeRequest): void
  killPty(agentId: AgentId): Promise<void>
  onPtyData(handler: (event: PtyDataEvent) => void): () => void
  onPtyExit(handler: (event: PtyExitEvent) => void): () => void
  refreshGit(agentId: AgentId): Promise<GitStatus>
  onGitStatus(handler: (event: GitStatusEvent) => void): () => void
  getScrollback(agentId: AgentId): Promise<string>

  /** Whether Mucka credentials are configured in main's env. */
  getMuckaStatus(): Promise<MuckaStatus>
  /** Mint a short-lived signed URL for ElevenLabs Conversational AI. */
  mintMuckaSignedUrl(): Promise<string>
  /** Trigger the macOS TCC mic prompt (no-op on other OSes). */
  requestMicAccess(): Promise<MicAccess>
  /** Open the macOS System Settings → Privacy → Microphone pane. */
  openMicSettings(): Promise<void>

  /* Notices (notice board) */
  listNotices(): Promise<Notice[]>
  addNotice(input: NoticeInput): Promise<Notice>
  removeNotice(id: string): Promise<boolean>
  removeNoticeByTitle(title: string): Promise<number>
}
