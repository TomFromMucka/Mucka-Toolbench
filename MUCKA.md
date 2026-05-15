# Mucka Toolbench — living spec

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

**Mucka tools (25).**

Read-only (auto-execute):
- `list_agents`, `get_git_status`, `get_recent_output`,
  `whats_happening`, `get_recent_events`, `get_vercel_status`,
  `get_pr_status`, `get_cockpit_doc`, `list_memories`, `get_memory`.

Chrome writes (auto-execute):
- `set_banner_status`, `append_note`, `flag_attention`,
  `clear_attention`, `set_agent_preview`, `remember`, `start_agent`.

Confirm-gated:
- `set_agent_worktree`, `set_agent_command`, `restart_agent`,
  `stop_agent`, `send_to_agent` (edit-confirm), `deploy_to_vercel`,
  `open_pr`, `forget`.

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

**Design system v2 (`src/renderer/src/styles/index.css` + `components/ui/`).**
The cockpit is dark-mode by default, sharing tokens and primitives with
Mucka Pro mobile. Brand tokens: `--orange #ff4e00` (reserved for Mucka
voice / attention), `--charcoal` (header bands + chunky CTAs),
`--van-white` (text), `--dirty-grey` (muted), `--surface` (cards),
`--surface2` (page bg, deepest). Typography is Söhne (Breit Kräftig for
display, regular for body/UI) via `t-display-*` / `t-heading-*` /
`t-body-*` / `t-label-*` utility classes. Universal panel is a
chamfered (octagonal) card — `chamfer-card` utility with 14 px corner
notches, charcoal header band, no wooden-clip or paper texture. Three
shared primitives in `components/ui/`:
- `<Button>` — primary / secondary / dark / tertiary / ghost ×
  lg(50px) / md(42px) / sm(34px), with V-notch on the primary's
  trailing arrow and the secondary's leading chip. Verbatim port.
- `<StatusPill>` — six variants: `on-site`, `pending`,
  `scheduled`, `completed`, `quote-sent`, `cancelled`. Orange tints
  = Mucka engaged, green = finished, grey = inert. Used by Vercel
  + Git panels.
- `<Icon>` — Lucide wrapper, defaults to size 24, stroke 2.25.

## Recent changes

(newest first — append here when shipping)

- **2026-05-15** — Preview viewport sizes. Each preview Clipboard has a
  device dropdown (Fit / iPhone SE…14 Pro Max / iPad Mini…12.9" / Desktop
  1280…1920) plus a rotate toggle for landscape. Picking a device portals
  the iframe to `document.body` at the chosen pixel size, anchored to
  the panel's body area with a high z-index — so larger-than-panel sizes
  overlap the Vercel/Git panels rather than reflowing the grid. Esc
  returns to Fit. Reload button still works, and bumping the size
  re-keys the iframe.
- **2026-05-15** — Folder picker on Start. The agent idle screen now
  opens a folder picker first (VSCode-style), persists the choice as
  the agent's worktreePath, then spawns the shell there. Small
  secondary "resume at <tail>" link skips the picker when returning to
  the same folder.
- **2026-05-15** — Explorer sidebar. New collapsible left column with a
  VSCode-style file tree. Top-of-panel dropdown switches between the
  four agent worktrees, a Reveal-in-Finder button (Lucide
  `FolderSearch`) calls `shell.showItemInFolder`, and clicking a file
  opens it with the OS default handler. The tree lazy-loads each
  folder via a new `src/main/fs` module + IPC; collapsed state +
  selected worktree persist in localStorage. Collapsed view is a thin
  charcoal rail with a folder-tree icon to re-expand.
- **2026-05-15** — Idle-until-started agents. Each agent has a
  persistent `running` flag in sqlite; new column defaults to `0`
  so the cockpit boots with all four agents stopped (no zsh
  processes spawned unprompted). The agent clipboard shows a Start
  screen with a `command + cwd` preview and a primary CTA; a Stop
  button lives in the running-state tab strip and tears down the
  primary shell + every sub-terminal. Two new Mucka tools wired:
  `start_agent` (auto-execute) and `stop_agent` (confirm-gated).
  Stopped agents show "stopped" in the status pill.
- **2026-05-15** — Mucka rebrand · Slices 1–4. The cockpit is now on
  the same design system as Mucka Pro mobile, in a dark-mode skin.
  Söhne (Sohne Breit Kräftig display + Sohne body) replaces Caveat
  + Patrick Hand. Brand tokens (`--orange`, `--charcoal`,
  `--van-white`, `--dirty-grey`, `--surface`, `--surface2`,
  status-pill tokens) drive every surface. Chamfered (octagonal)
  cards replace the wooden-clip + paper Clipboard. Button +
  StatusPill + Icon primitives ported verbatim. Attention glow
  switched to `filter: drop-shadow` so it follows the chamfered
  silhouette. Header band sits at charcoal with Söhne Breit title;
  the title now insets past the 14 px corner chamfers. Status
  pills (Vercel state, GitHub CI summary) now use the brand
  StatusPill vocabulary (`completed` / `pending` / `cancelled`),
  with ad-hoc red for `error` / `failure`.
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

