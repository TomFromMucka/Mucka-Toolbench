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

/* ─── Job sheet events ───────────────────────────────────────────────── */

/**
 * Source attribution for an event. Either one of the four agents, the
 * Mucka PM, or the cockpit itself (boot, settings change, etc.).
 */
export type JobEventSource = AgentId | 'mucka' | 'system'

export type JobEventTone = 'normal' | 'attention' | 'win' | 'bad'

export interface JobEvent {
  /** Stable id — sqlite rowid as a string. */
  id: string
  /** ms since epoch. */
  ts: number
  source: JobEventSource
  /** Short machine-readable kind (e.g. "vercel.ready", "github.pr_open"). */
  kind: string
  message: string
  tone: JobEventTone
}

/** Shape main passes to logEvent — id+ts get filled in. */
export interface JobEventInput {
  source: JobEventSource
  kind: string
  message: string
  tone?: JobEventTone
  /** Override the timestamp (rarely useful). */
  ts?: number
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
  /**
   * Whether the agent's primary PTY is currently running. When false the
   * clipboard shows a "Start" screen and no shells are spawned. Persists
   * across cockpit restarts so an intentionally-stopped agent stays
   * stopped next session.
   */
  running: boolean
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
    | 'running'
  >
> & { id: AgentId }

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

/** Main → renderer: agent status detected from PTY heuristics. */
export interface AgentStatusEvent {
  agentId: AgentId
  status: AgentStatus
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

/* ─── Mucka text-chat (Claude API mirror of the voice session) ───────── */

export type MuckaTextStatus =
  | { kind: 'ok' }
  | { kind: 'missing-key' }
  | { kind: 'error'; message: string }

/**
 * A rendered chat message. Assistant messages can interleave text and
 * tool-call summaries so the UI can show "called open_pr" inline.
 */
export interface MuckaTextSegment {
  kind: 'text' | 'tool_call'
  text: string
  /** When kind === 'tool_call', the tool name. */
  toolName?: string
  /**
   * Where this segment came from. Undefined / 'text' for typed Claude
   * chat. 'voice' for utterances captured from the ElevenLabs session;
   * the UI shows a small mic glyph beside them.
   */
  source?: 'text' | 'voice'
}

/** Renderer → main: persist a voice utterance into the shared chat log. */
export interface VoiceTranscriptInput {
  role: 'user' | 'assistant'
  text: string
  /** ms since epoch — defaults to now() in main if omitted. */
  ts?: number
}

/**
 * Shape returned by getCockpitDoc(section?). When the doc file is
 * missing, `found` is false and `text` is empty. When a section is
 * requested but not matched, `found` is false but `sections` still
 * lists what's available so Mucka can guide Tom (or pick again).
 */
export interface CockpitDocPayload {
  text: string
  sections: string[]
  found: boolean
}

/* ─── Roadmap kanban ─────────────────────────────────────────────────── */

/**
 * Kanban columns, in left-to-right display order.
 * - backlog: raw ideas that aren't queued yet
 * - next:    queued — pull next when there's capacity
 * - doing:   in flight right now
 * - shipped: landed (replaces the manual Recent-changes log over time)
 * - parked:  not now, but worth keeping (low-priority or paused)
 */
export type RoadmapColumn = 'backlog' | 'next' | 'doing' | 'shipped' | 'parked'

export interface RoadmapCard {
  id: string
  title: string
  /** Optional longer body — markdown-ish plain text. */
  body: string
  column: RoadmapColumn
  /** Position within the column, lower first. */
  sortOrder: number
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface RoadmapCreateInput {
  /** Optional client-generated id so attachments saved before create resolve. */
  id?: string
  title: string
  body?: string
  column: RoadmapColumn
  tags?: string[]
  /** When set, insert at this sortOrder; otherwise append to the end of the column. */
  sortOrder?: number
}

export interface RoadmapAttachment {
  filename: string
  /** mucka-asset:// URL suitable for use in markdown ![]() */
  url: string
}

export interface RoadmapUpdateInput {
  id: string
  title?: string
  body?: string
  tags?: string[]
}

export interface RoadmapMoveInput {
  id: string
  column: RoadmapColumn
  /** New position in target column (0-based). Omit to append to end. */
  sortOrder?: number
}

/* ─── Filesystem (Explorer panel) ────────────────────────────────────── */

export type FsEntryKind = 'dir' | 'file' | 'symlink' | 'other'

export interface FsEntry {
  name: string
  kind: FsEntryKind
  /** True when the name begins with a dot — UI can dim/hide. */
  isHidden: boolean
}

/** Result of listing a directory. `exists` is false when the path is missing. */
export interface FsListing {
  path: string
  exists: boolean
  entries: FsEntry[]
  /** Populated when the listing failed (permission, non-dir, etc.). */
  error: string | null
}

/* ─── Long-term memory ───────────────────────────────────────────────── */

/**
 * Kinds of memory Mucka can write/recall:
 * - profile     facts about Tom (role, what he cares about)
 * - preference  how Tom wants things done (style, defaults)
 * - project     ongoing initiatives, deadlines, who's doing what
 * - decision    choices made and why — load-bearing for future edge cases
 * - note        catch-all for anything else worth keeping
 */
export type MemoryType = 'profile' | 'preference' | 'project' | 'decision' | 'note'

export interface Memory {
  topic: string
  type: MemoryType
  body: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** Lightweight index entry — body omitted so Mucka can scan cheaply. */
export interface MemoryListItem {
  topic: string
  type: MemoryType
  preview: string
  tags: string[]
  updatedAt: number
}

export interface MemoryListQuery {
  type?: MemoryType
  tag?: string
  limit?: number
}

export interface MemoryWriteInput {
  topic: string
  type: MemoryType
  body: string
  tags?: string[]
}

export interface MuckaTextMessage {
  id: string
  ts: number
  role: 'user' | 'assistant'
  segments: MuckaTextSegment[]
}

/** Streamed deltas from main → renderer while an assistant turn is in flight. */
export interface MuckaTextStreamEvent {
  messageId: string
  /** Text to append to the message's last text segment (creates one if none). */
  appendText?: string
  /** A tool call landed — append a tool_call segment. */
  toolCall?: { toolName: string; summary: string }
  /** True on the final event of this turn. */
  done?: boolean
}

/** Renderer must execute the tool and post the result back. */
export interface MuckaTextToolCall {
  callId: string
  name: string
  params: Record<string, unknown>
}

export interface MuckaTextToolResult {
  callId: string
  ok: boolean
  /** Stringified tool output (success) or error message (failure). */
  result: string
}

/** Shape exposed on window.mucka (see preload). */
export interface MuckaApi {
  listAgents(): Promise<AgentConfig[]>
  updateAgent(patch: AgentUpdate): Promise<AgentConfig>
  /** Spawn the agent's primary shell + flip `running` to true. */
  startAgent(agentId: AgentId): Promise<AgentConfig>
  /** Kill the agent's primary + all sub-terminals, set `running` false. */
  stopAgent(agentId: AgentId): Promise<AgentConfig>
  pickDirectory(opts?: { defaultPath?: string }): Promise<string | null>
  spawnPty(req: PtySpawnRequest): Promise<void>
  writePty(req: PtyWriteRequest): void
  resizePty(req: PtyResizeRequest): void
  killPty(terminalId: TerminalId): Promise<void>
  onPtyData(handler: (event: PtyDataEvent) => void): () => void
  onPtyExit(handler: (event: PtyExitEvent) => void): () => void
  refreshGit(agentId: AgentId): Promise<GitStatus>
  onGitStatus(handler: (event: GitStatusEvent) => void): () => void
  onAgentStatus(handler: (event: AgentStatusEvent) => void): () => void
  getScrollback(terminalId: TerminalId): Promise<string>

  /** Renderer → main: tell the OS shell (dock) about pending attention. */
  notifyAttention(count: number): void

  /** Whether Mucka credentials are configured in main's env. */
  getMuckaStatus(): Promise<MuckaStatus>
  /** Mint a short-lived signed URL for ElevenLabs Conversational AI. */
  mintMuckaSignedUrl(): Promise<string>
  /** Trigger the macOS TCC mic prompt (no-op on other OSes). */
  requestMicAccess(): Promise<MicAccess>
  /** Open the macOS System Settings → Privacy → Microphone pane. */
  openMicSettings(): Promise<void>

  /* Text-mode Mucka chat (parallel to the voice session) */
  getMuckaTextStatus(): Promise<MuckaTextStatus>
  listChatHistory(): Promise<MuckaTextMessage[]>
  sendChatMessage(text: string): Promise<void>
  clearChatHistory(): Promise<void>
  sendChatToolResult(result: MuckaTextToolResult): void
  onChatStream(handler: (event: MuckaTextStreamEvent) => void): () => void
  onChatToolCall(handler: (call: MuckaTextToolCall) => void): () => void
  onChatMessage(handler: (message: MuckaTextMessage) => void): () => void
  /** Persist a single voice utterance into the unified chat log. */
  appendVoiceTranscript(input: VoiceTranscriptInput): void

  /**
   * Read the cockpit's living spec (`MUCKA.md`). Pass a section name
   * (matching a `## Heading`) to get just that slice; omit for the
   * whole doc. `sections` always lists available headings.
   */
  getCockpitDoc(section?: string): Promise<CockpitDocPayload>

  /* Long-term memory (Mucka's persistent notes about Tom + projects) */
  listMemories(query?: MemoryListQuery): Promise<MemoryListItem[]>
  getMemory(topic: string): Promise<Memory | null>
  rememberMemory(input: MemoryWriteInput): Promise<Memory>
  forgetMemory(topic: string): Promise<boolean>

  /* Roadmap kanban — sqlite-backed cards, mirrored to MUCKA.md ## Roadmap */
  listRoadmap(): Promise<RoadmapCard[]>
  createRoadmapCard(input: RoadmapCreateInput): Promise<RoadmapCard>
  updateRoadmapCard(input: RoadmapUpdateInput): Promise<RoadmapCard>
  moveRoadmapCard(input: RoadmapMoveInput): Promise<RoadmapCard>
  deleteRoadmapCard(id: string): Promise<boolean>
  onRoadmapUpdate(handler: () => void): () => void

  /** Save a pasted/dropped image to the card's attachment folder. */
  attachRoadmapImage(input: {
    cardId: string
    name: string
    /** Raw bytes — Uint8Array transfers cleanly across IPC. */
    bytes: Uint8Array
  }): Promise<RoadmapAttachment>

  /* Filesystem — used by the Explorer sidebar */
  listDir(path: string): Promise<FsListing>
  /** Reveal a file or folder in the OS file manager (Finder on macOS). */
  revealInOs(path: string): Promise<void>
  /** Open a file or folder with the OS default handler. */
  openPathInOs(path: string): Promise<void>

  /* Free-form notes (replaces the notice board) */
  getNote(): Promise<string>
  setNote(value: string): Promise<void>
  appendNote(chunk: string): Promise<string>
  onNoteUpdate(handler: (value: string) => void): () => void

  /* Job-sheet events */
  listEvents(limit?: number): Promise<JobEvent[]>
  onEventAppend(handler: (event: JobEvent) => void): () => void

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
