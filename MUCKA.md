# Mucka Workstation — living spec

> Source of truth for what the cockpit is, what works today, and what's
> next. Mucka pulls this on demand via `get_cockpit_doc` — it isn't
> baked into her every prompt.
>
> **Update convention.** Any session that ships a meaningful change to
> the cockpit appends to *Recent changes* (newest first) and updates
> *Capabilities* / *Systems* if the change is user-facing.

## Mission

A personal dev cockpit for Tom. One Electron window, sized for a
3840×1200 ultrawide. Four Claude Code agents run in parallel git
worktrees on the left; in the middle Mucka acts as PM (voice via
ElevenLabs, text via the Anthropic API, same toolset on both); the
right column hosts two live dev-server previews stacked above a
Vercel-deployments and a GitHub-PR clipboard. The visual language is
deliberate: dark workshop wood for chrome, cream paper for
information, brand orange (`#FF4E00`) reserved for "Mucka is talking"
or "Tom, eyes here".

## Capabilities (what works today)

**Agent grid (left).**
- Four agent clipboards (Dave, Sammy, Kev, Bren) — each a real
  node-pty + xterm.js terminal at its worktree.
- Tab strip per agent: `+` to split, `▶ preview` to kill any prior
  preview tab and spawn a fresh one that auto-types `npm run dev` and
  binds the detected `http://localhost:N` URL to the preview iframe.
- Status pill (top-right of each clipboard) flips between
  `idle` / `thinking` / `awaits Tom` based on Claude Code TUI cues
  parsed from the PTY (`esc to interrupt`, permission prompts).
- Attention glow: orange ring + chime + macOS dock bounce/badge
  whenever `needsAttention` flips true on any agent.
- Per-agent headline below the clip header — latest job-sheet event
  for that agent, or Mucka's attention reason if she flagged it.
- Per-agent git badges (branch · ahead/behind · dirty/untracked).

**Mucka middle column.**
- Voice mode (ElevenLabs Conv AI) — `⌘M` or banner mic button.
  Connection acknowledged by a two-tone chime; no spoken welcome.
- Text mode (Claude `claude-sonnet-4-6`, streaming, prompt-cached)
  with full tool parity to voice. Type in the chat input; voice
  session is not disturbed.
- **Shared chat history** — voice utterances and typed turns persist
  to the same `chat_messages` table, so each mode sees what the other
  has said. Voice bubbles render with a thin orange border + italic
  and a `voice` tag in the footer.
- Job sheet — live event feed (Vercel transitions, PR/CI flips,
  attention flags, cockpit boots, config changes). Day separators,
  newest first.
- Notes scratchpad — free-form textarea, 600 ms debounced autosave
  to sqlite, flushed on blur and ⌘S.

**Right column.**
- Two preview iframes (top + middle) — bind via the per-agent
  preview button or Mucka's `set_agent_preview` tool.
- Vercel clipboard (bottom-left) — latest deployment per
  `project + branch` with status pill (queued / building / ready /
  error) and URL.
- Git clipboard (bottom-right) — open PR + rolled-up CI status per
  agent's branch, with PR title and link.

**Top banner.**
- Mucka's PM status line (settable via `set_banner_status`).
- Mic button + voice state indicator.
- Settings sheet — edit each agent's display name, branch,
  worktreePath, command/args, Vercel project id.

**Mucka tools (23).**

Read-only (auto-execute):
- `list_agents`, `get_git_status`, `get_recent_output`,
  `whats_happening`, `get_recent_events`, `get_vercel_status`,
  `get_pr_status`, `get_cockpit_doc`, `list_memories`, `get_memory`.

Chrome writes (auto-execute):
- `set_banner_status`, `append_note`, `flag_attention`,
  `clear_attention`, `set_agent_preview`, `remember`.

Confirm-gated:
- `set_agent_worktree`, `set_agent_command`, `restart_agent`,
  `send_to_agent` (edit-confirm), `deploy_to_vercel`, `open_pr`,
  `forget`.

## Systems

**Process layout.** Electron with strict main / preload / renderer
split. PTY, sqlite, git, Vercel + GitHub pollers, ElevenLabs signed
URL minting, Claude API: all main. Renderer never touches the
filesystem directly — everything flows through preload-exposed
`window.mucka.*` IPC.

**PTY (`src/main/pty`).** node-pty processes keyed by `terminalId`
(string). The agent's *primary* terminal uses `terminalId === agentId`
so older Mucka tools that target an `agent` still hit the right
buffer. Split terminals get distinct ids like `dave:t2`. PtyManager
proxies data + exit events through IPC; scrollback persists to disk
for the primary terminals only.

**StatusDetector (`src/main/pty/StatusDetector.ts`).** Sliding
4KB ANSI-stripped buffer per primary terminal. Heuristic state
detection: `esc to interrupt` → thinking; `Do you want to proceed`,
`❯ 1.`, `Trust the files…` → awaiting-input. 2s silence → decay to
idle.

**Database (`src/main/db`).** better-sqlite3, migrated idempotently
on boot. Tables: `agents`, `kv` (notes), `events` (job sheet, capped
500), `chat_messages` (capped 500, holds text + voice transcripts
with optional `source: 'voice'` segment tag).

**Event stream (`src/main/events`).** `logEvent({source, kind,
message, tone})` inserts + broadcasts. Sources: agent ids, `mucka`,
`system`. Used by the job sheet panel and the per-agent headline.

**Vercel poller (`src/main/vercel`).** REST `/v6/deployments` every
30s. Reads `.vercel/project.json` from the worktree when no manual
project id is set. Team-scoped tokens only — auto-detected by
prefix-matching `team_`. Emits update events for state transitions.

**GitHub poller (`src/main/github`).** REST `/repos/{o}/{r}/pulls`
+ `/check-runs` every 60s. Parses the worktree's `.git/config`
origin (handles SSH and HTTPS). Emits events on PR open/close and
CI summary flips.

**Mucka voice (`src/main/mucka/Mucka.ts`).** Mints short-lived signed
URLs for `@elevenlabs/react`'s `useConversation`. Tools registered
with `startSession` via the shared `clientTools` map. Prompt is
source-of-truth in `src/main/mucka/prompts/pm.md`; sync to the agent
with `npm run mucka:sync`.

**Mucka text (`src/main/mucka/MuckaText.ts`).** Anthropic SDK,
streaming with tool-use loop. Tools dispatch back to the renderer
over IPC; results return via a pending-call Map with a 60s timeout.
System prompt is the same `pm.md` content, with prompt caching set
to `ephemeral`.

**Cockpit doc (`src/main/doc/CockpitDoc.ts`).** Reads `MUCKA.md`
from the project root, caches by mtime, optionally returns a single
`##` section. Mucka pulls it via the `get_cockpit_doc` tool.

**Long-term memory (`src/main/db/memories.ts`).** sqlite `memories`
table, upserted by topic. Five types: `profile`, `preference`,
`project`, `decision`, `note`. Mucka has four tools — `list_memories`
returns a cheap topic+preview index (no bodies), `get_memory` pulls
one full body, `remember` writes/updates, `forget` is confirm-gated.
Designed so a small "Tom — at a glance" slice lives in the prompt
and everything else stays out until Mucka pulls it.

## Recent changes

(newest first — append here when shipping)

- **2026-05-14** — Settings sheet gets a *Memory* tab. List of
  everything Mucka has stored, grouped by type filter, expandable
  rows with body + tags. Inline edit / forget. Closes the loop on
  the memory store — Tom can audit what she knows.
- **2026-05-14** — Long-term memory. New `memories` table + four
  Mucka tools (`list_memories`, `get_memory`, `remember`, `forget`).
  Small "Tom — at a glance" slice in `pm.md` keeps the always-on
  context tight; everything else lives on disk and is pulled on
  demand. Memory workflow guidance in `pm.md` (notice → check →
  amend/replace/new) so she updates existing memories rather than
  fragmenting the store.
- **2026-05-14** — Living `MUCKA.md` + `get_cockpit_doc` tool. Mucka
  can read the cockpit's own spec on demand.
- **2026-05-14** — Voice + text shared transcript. ElevenLabs
  utterances now persist into `chat_messages` (with a `source:
  'voice'` segment tag); both modes see one continuous history.
- **2026-05-14** — Agent status pill from PTY heuristics + attention
  chime + dock badge/bounce. Status dot is real, not mock.
- **2026-05-14** — Text-mode Mucka via Claude + two-tone connection
  chime. Typing no longer disturbs the voice session.
- **2026-05-14** — Coherence pass: agent headlines now show the
  latest event for that agent; added `get_recent_events` tool.
- **2026-05-14** — Notes scratchpad (replaces the notice board) and
  real Job Sheet driven by the event stream.
- **2026-05-14** — Phase 5: Vercel + Git panels side-by-side at the
  bottom of the right column; split terminals with `▶ preview`
  auto-wiring `npm run dev` → iframe.
- **2026-05-14** — Phase 4: Mucka can type into agent terminals
  (`send_to_agent`, `open_pr`, `deploy_to_vercel`).
- **2026-05-13** — Phase 3 write tools (auto + confirm-gated).
- **2026-05-13** — Phase 2 read-only tools.
- **2026-05-13** — Phase 1 Mucka PM voice agent wired.
- **2026-05-13** — Real PTYs via node-pty + xterm.js, scrollback
  persistence, settings sheet for agent config, live git status.
- **2026-05-13** — Visual shell (paper-and-ink workstation layout).
- **2026-05-13** — electron-vite + React + TS baseline.

## Roadmap

### Next up
- **Cross-agent broadcast.** One Mucka tool + a `⌘⏎` shortcut in
  the chat input to fan the same prompt to all four (or a subset
  of) terminals. Workflow win when parallelising similar work.
- **Keyboard shortcuts.** `⌘1-4` focus an agent's primary terminal,
  `⌘K` command palette, `⌘J` jump to job sheet, `⌘N` focus notes.

### Parked / maybe later
- **Mucka Pro worktree folder layout** (parked 2026-05-14). Tom is
  considering an umbrella `Mucka Pro/` folder with a sibling `main/`
  clone + four worktree subdirs (`dave/`, `sammy/`, `kev/`, `bren/`).
  The cockpit doesn't care about layout — each agent's `worktreePath`
  is an absolute path. Pick up when Tom has the worker agents
  actively running on Mucka Pro branches.
- Worktree management UI (create / delete / rename from the cockpit).
- CI rerun shortcut (button per failed check via gh CLI).
- Agent presets (quickly swap an agent between projects/branches).
- Per-agent Mucka write tool — let Mucka edit `MUCKA.md` herself
  rather than only reading it.

### Deferred
- Proactive voice nudges (Tom explicitly skipped this — don't
  re-propose without checking).
