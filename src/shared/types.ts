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

export interface MuckaChatMessage {
  id: string
  from: 'mucka' | 'tom'
  timestamp: string
  text: string
}

/* ─── PTY IPC contract ───────────────────────────────────────────────── */

/**
 * Opaque identifier for a single PTY process. Each agent has at least one
 * terminal; its primary terminal uses `terminalId === agentId` so older
 * Mucka tools that take an `agent` keep mapping to the right buffer.
 * Secondary (split) terminals use a distinct string such as `dave:t2`.
 */
export type TerminalId = string

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
  /**
   * Dev-server URL to render in the right-column preview slot.
   * Null means "no preview for this agent". The first two agents with a
   * non-null previewUrl fill the left and right preview clipboards.
   */
  previewUrl: string | null
  /**
   * Vercel project id this agent's worktree maps to (the `prj_*` string).
   * When null, the cockpit tries to auto-detect from `.vercel/project.json`
   * in the worktree on demand. Explicit value here overrides auto-detect.
   */
  vercelProjectId: string | null
}

/**
 * Renderer → main: start a PTY for a terminal at the owning agent's
 * configured cwd. `agentId` is only used to look up the cwd/command at
 * spawn time; subsequent IPC is keyed by `terminalId`.
 */
export interface PtySpawnRequest {
  terminalId: TerminalId
  agentId: AgentId
  cols: number
  rows: number
}

/** Main → renderer: a chunk of terminal output. */
export interface PtyDataEvent {
  terminalId: TerminalId
  data: string
}

/** Main → renderer: the PTY process exited. */
export interface PtyExitEvent {
  terminalId: TerminalId
  exitCode: number
  signal: number | null
}

/** Renderer → main: forward user input to the PTY's stdin. */
export interface PtyWriteRequest {
  terminalId: TerminalId
  data: string
}

/** Renderer → main: PTY size changed (xterm fit-addon). */
export interface PtyResizeRequest {
  terminalId: TerminalId
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
    | 'previewUrl'
    | 'vercelProjectId'
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
  killPty(terminalId: TerminalId): Promise<void>
  onPtyData(handler: (event: PtyDataEvent) => void): () => void
  onPtyExit(handler: (event: PtyExitEvent) => void): () => void
  refreshGit(agentId: AgentId): Promise<GitStatus>
  onGitStatus(handler: (event: GitStatusEvent) => void): () => void
  getScrollback(terminalId: TerminalId): Promise<string>

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

  /* Vercel */
  getVercelStatus(): Promise<VercelStatus>
  listVercelDeployments(agentId: AgentId): Promise<VercelAgentSummary>
  listAllVercelDeployments(): Promise<Record<AgentId, VercelAgentSummary>>
  refreshVercel(agentId: AgentId): Promise<VercelAgentSummary>
  onVercelUpdate(
    handler: (event: VercelUpdateEvent) => void
  ): () => void

  /* GitHub */
  getGitHubStatus(): Promise<GitHubStatus>
  listGitHubSummary(agentId: AgentId): Promise<GitHubAgentSummary>
  listAllGitHubSummaries(): Promise<Record<AgentId, GitHubAgentSummary>>
  refreshGitHub(agentId: AgentId): Promise<GitHubAgentSummary>
  onGitHubUpdate(
    handler: (event: GitHubUpdateEvent) => void
  ): () => void
}

/* ─── Vercel integration ─────────────────────────────────────────────── */

export type VercelStatus =
  | { kind: 'ok' }
  | { kind: 'missing-token' }
  | { kind: 'error'; message: string }

/** Subset of Vercel's deployment readyState we care to display. */
export type VercelDeploymentState =
  | 'queued'
  | 'building'
  | 'ready'
  | 'error'
  | 'canceled'
  | 'unknown'

export type VercelTarget = 'production' | 'preview' | 'staging' | null

/** One deployment row — shape we surface to the renderer. */
export interface VercelDeployment {
  id: string
  /** Human-readable project name (Vercel's `name` field on the deployment). */
  projectName: string | null
  /** True production deployment (vs preview). */
  isProduction: boolean
  target: VercelTarget
  state: VercelDeploymentState
  /** Branch the deployment was triggered from, if Vercel knows. */
  branch: string | null
  /** Commit SHA (40 char), if available. */
  commitSha: string | null
  /** First line of the commit message. */
  commitMessage: string | null
  /** "https://my-project-abc.vercel.app" — main domain. */
  url: string | null
  /** Created-at in ms since epoch. */
  createdAt: number
  /** Inspection URL on the Vercel dashboard. */
  inspectorUrl: string | null
  /** Build error summary, if state === 'error'. */
  errorMessage: string | null
}

/** Per-agent Vercel summary — what the panel renders one row from. */
export interface VercelAgentSummary {
  agentId: AgentId
  /** Resolved project id (manual override or auto-detected). */
  projectId: string | null
  /** How we got the project id — useful for the missing-config UI. */
  source: 'configured' | 'auto-detected' | 'none'
  /** Latest production deployment, if any. */
  latestProduction: VercelDeployment | null
  /** Latest deployment whose Vercel meta-branch matches AgentConfig.branch. */
  latestForBranch: VercelDeployment | null
  /** Most recent deployment regardless of branch/target. */
  latestAny: VercelDeployment | null
  /** Last poll timestamp, ms. */
  checkedAt: number
  /** Set when the API call failed (auth, network, project missing, etc). */
  error: string | null
}

export interface VercelUpdateEvent {
  agentId: AgentId
  summary: VercelAgentSummary
}

/* ─── GitHub integration ─────────────────────────────────────────────── */

export type GitHubStatus =
  | { kind: 'ok' }
  | { kind: 'missing-token' }
  | { kind: 'error'; message: string }

export type PullRequestState = 'open' | 'closed' | 'merged' | 'draft'

/** Roll-up of all check runs for a SHA. */
export type CheckSummary = 'success' | 'failure' | 'pending' | 'none'

export interface PullRequest {
  number: number
  title: string
  /** GitHub web URL. */
  url: string
  state: PullRequestState
  isDraft: boolean
  authorLogin: string | null
  headBranch: string
  baseBranch: string
  /** GitHub's mergeable_state — clean, blocked, dirty, behind, unstable, has_hooks, unknown. */
  mergeableState: string | null
  /** Boolean mergeable flag. Null when GitHub hasn't computed yet. */
  mergeable: boolean | null
  headSha: string
  createdAt: number
  updatedAt: number
}

export interface CheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'timed_out'
    | 'action_required'
    | 'skipped'
    | 'stale'
    | null
  /** Link to the check's UI on GitHub. */
  url: string | null
}

export interface GitHubAgentSummary {
  agentId: AgentId
  /** Detected from the worktree's git origin URL. Null when not a GitHub repo. */
  repo: { owner: string; name: string } | null
  /** Branch we asked about — agent's configured branch. */
  branch: string
  /** Most recent open PR with head === branch (could be null even with a repo). */
  openPr: PullRequest | null
  /** Check runs on the PR head SHA. Empty when no PR. */
  checks: CheckRun[]
  /** Rolled-up status: any failure → failure, any in-progress → pending, all success → success. */
  checkSummary: CheckSummary
  /** Last poll timestamp. */
  checkedAt: number
  /** Set when the API call failed. */
  error: string | null
}

export interface GitHubUpdateEvent {
  agentId: AgentId
  summary: GitHubAgentSummary
}
