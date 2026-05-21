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
- Text mode via the Claude Agent SDK — uses Tom's Claude Code
  subscription auth (`claude login`), no API key required. Streams
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

**Mucka tools (34).**

Read-only (auto-execute):
- `list_agents`, `get_git_status`, `get_recent_output`,
  `whats_happening`, `get_recent_events`, `get_vercel_status`,
  `get_pr_status`, `get_cockpit_doc`, `get_product_doc`,
  `list_memories`, `get_memory`, `list_roadmap`, `read_pr_diff`.

Chrome writes (auto-execute):
- `set_banner_status`, `append_note`, `flag_attention`,
  `clear_attention`, `set_agent_preview`, `remember`, `start_agent`,
  `create_roadmap_card`, `update_roadmap_card`, `move_roadmap_card`.

Confirm-gated:
- `set_agent_worktree`, `set_agent_command`, `restart_agent`,
  `stop_agent`, `send_to_agent` (edit-confirm),
  `broadcast_to_agents` (edit-confirm), `post_pr_review` (edit-confirm),
  `deploy_to_vercel`, `open_pr`, `forget`, `delete_roadmap_card`.

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

**Mucka text (`src/main/mucka/MuckaTextAgent.ts` +
`src/main/mucka/agentTools.ts`).** `@anthropic-ai/claude-agent-sdk`
(`query()`) under the hood — spawns the `claude` CLI so the user's
Pro/Max subscription auth applies (no ANTHROPIC_API_KEY needed).
Streams via `includePartialMessages: true`, parses
`content_block_delta` text deltas for live typing, persists final
assistant turns to the same `chat_messages` table as voice. Tools
are converted from the shared `TOOL_DEFINITIONS` schema into
Zod-backed `tool()` defs and bundled in an in-process MCP server
(`buildMuckaMcpServer`) passed via `options.mcpServers`. Each tool
handler dispatches back to the renderer over IPC; results return
via a pending-call Map with a 60s timeout. Session continuity
across turns this boot uses `options.continue: true`.

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

- **2026-05-21** — Mucka text mode: fix `spawn ENOTDIR` in packaged
  builds. The Agent SDK's spawned `claude` was inheriting
  `cwd: app.getAppPath()`, which in production resolves to
  `…/Resources/app.asar` — a file, not a directory, so the OS rejected
  the chdir. Switched to `app.getPath('userData')` which is always a
  real on-disk dir. Voice mode was unaffected.

- **2026-05-21** — Explorer file preview modal. Clicking a file in the
  explorer no longer hands off to macOS, which was sending `.md` to an
  external IDE and `.env` to the dead-end "no application set" dialog.
  Instead the cockpit opens an in-app paper-and-ink modal with line
  numbers, byte size in the footer, Esc to close, and "Open in default
  app" / "Reveal in Finder" buttons when Tom does want the OS handler.
  Main classifies the file (binary, too-large >2 MB, missing) before
  sending so the renderer never sees a binary blob. Right-click → Open
  with default app is still there for muscle memory.

- **2026-05-21** — Browser slot z-order: whichever pane you interact
  with comes to the top. `WebContentsView` children render in
  insertion order, so a desktop-viewport popout in the top slot was
  being clipped under the bottom slot's view whenever they overlapped.
  Added `raiseSlot(slotId)` (remove + re-add the active view) and call
  it on open / switch / set-bounds, plus a `browser:raise` IPC that
  the renderer fires on `mousedown` anywhere in the pane chrome.

- **2026-05-19** — Tabbed browser polish: right-click + viewport
  presets. Each tab's `WebContentsView` now gets the same context-menu
  treatment as the main window (Cut/Copy/Paste/Select All plus the
  Credentials library's Insert username/password submenu) — so
  right-clicking inside a login form on a real site now offers your
  saved credentials. Viewport preset selector is back in the URL bar
  with phones/tablets/desktops + a portrait/landscape toggle. Phones
  and tablets that fit inside the slot get centered with native pixel
  width; desktop sizes wider than the slot scale via per-slot
  `setZoomFactor`, so a 1440-wide page renders to fit while CSS still
  queries at 1440.
- **2026-05-18** — Preview panes become a real tabbed browser.
  Each of the two slots in the right column now hosts its own stack of
  tabs, each tab a main-process `WebContentsView` — real browser
  semantics (back/forward history, cookies persisting via
  `persist:browser` partition, cross-origin without CSP gymnastics).
  Tab strip + URL bar in the renderer; main positions the views by
  bounds reservation. `+` opens a new tab, click to switch, middle-
  click or `×` to close, `window.open` from inside a tab spawns
  another tab in the same slot. The agent-bound auto-bootstrap
  behaviour is preserved: a slot with an agent that has a previewUrl
  auto-opens that URL as the first tab. ⌘-click on a URL in an agent
  terminal now opens it as a new tab in that agent's slot (preferred)
  or any available slot. The old iframe-based BrowserPreview component
  is removed. New main module:
  `src/main/browser/BrowserManager.ts`. New shared types in
  `src/shared/browser.ts`.

  *Trade-off accepted*: the device-viewport presets (iPhone, iPad,
  Desktop · 1440) are gone in this slice — the iframe portal trick
  doesn't translate to WebContentsView. A follow-up can add fixed-
  width "responsive" mode via slot bounds if useful.
- **2026-05-17** — Explorer goes live. Each open folder is now watched
  non-recursively in the main process via `chokidar` (sub-100ms updates,
  near-zero steady-state CPU). When an agent's terminal writes a file
  in a worktree the Explorer is showing, the tree refreshes
  automatically — no more "I missed it because I was looking at the
  terminal". Non-recursive by design: `node_modules` never gets watched
  unless you specifically expand it. Renderer reloads in place without
  flashing "Loading…" on already-shown rows. New main module:
  `src/main/fs/Watcher.ts`. New IPC: `fs:watch`, `fs:unwatch`,
  `fs:changed`.
- **2026-05-17** — Credentials library + right-click insert in preview
  iframes. Settings → Credentials manages a list of `label · username ·
  password` entries (encrypted via safeStorage, stored in
  `<userData>/credentials.enc.json`). Right-clicking any input inside a
  preview iframe pops a native menu — Insert password on password
  fields, Insert username on text/email fields — pulling from the
  library. Works on cross-origin sites: the cockpit uses
  `WebFrameMain.executeJavaScript()` at the Electron layer to bypass
  the iframe sandbox. Last-used credential floats to the top of the
  menu so username→password fill is two right-clicks. New main
  modules: `src/main/credentials/Credentials.ts` (CRUD),
  `src/main/contextMenu/InputMenu.ts` (menu + injection).
- **2026-05-17** — ⌘-click on a URL in an agent's terminal now opens
  it in the cockpit's preview pane (auto-switched to the `desktop ·
  1440` viewport) instead of the system browser. Preference: the
  preview slot already bound to that agent; else left slot; else right.
  ⌘-shift-click preserves the old behaviour and opens in the system
  browser. Routing layer at `src/renderer/src/state/previewBus.ts`.
- **2026-05-17** — Settings → API Keys tab. Credentials are now
  enterable in-app, encrypted at rest via Electron's `safeStorage`
  (macOS Keychain / Windows DPAPI), and persisted to
  `<userData>/secrets.enc.json`. Per-row Save / Test / Clear; Test
  buttons hit `/v1/user` (ElevenLabs), `/user` (GitHub),
  `/v2/user` (Vercel) and report green/red. `.env` still works as a
  fallback for any key not entered through the UI. Source-of-truth
  badge per row (encrypted store · from .env · not set). New main
  module at `src/main/secrets/Secrets.ts`, shared defs at
  `src/shared/secrets.ts`. electron-builder also flipped to publish
  releases directly (`releaseType: release`) rather than as drafts.
- **2026-05-17** — Toolbench repo went public on GitHub.
  `TomFromMucka/Mucka-Toolbench` is now MIT-licensed and open. The
  cockpit's commercial PM voice (`pm.md`) and operator product context
  (`PRODUCT.md`) live in `~/.mucka-toolbench/` overrides outside the
  repo. Auto-updater (manual-trigger) confirmed working against the
  v0.2.1 release.
- **2026-05-16** — Repo prepped for public release. `pm.md` (the PM
  prompt) and `PRODUCT.md` (the product doc) now read from
  `~/.mucka-toolbench/` first and fall back to the shipped scaffolds.
  Operators keep their personalised voice + product context outside
  the repo. `npm run mucka:sync` refuses to overwrite a non-empty live
  prompt with the shipped generic unless `--use-bundled-prompt` is
  passed.
- **2026-05-16** — In-app auto-updater. `electron-updater` wired with
  GitHub Releases publish target (`TomFromMucka/Mucka-Toolbench`).
  Manual-trigger only — no polling — via a new **Updates** tab in
  the Settings sheet. Tab shows installed version, "Check for
  updates" button, then "Download" → "Restart and install" once a
  newer release is on the repo. New `npm run release:mac` script
  builds + publishes the DMG + `latest-mac.yml` to GitHub. Version
  bumped to 0.2.0 to mark this baseline.
- **2026-05-16** — Per-column agent panel expand/collapse.
- **2026-05-16** — Preview URL bar made interactive + iframe sandbox
  dropped so dev-server logins persist.
- **2026-05-16** — Product context + PR reviews. `PRODUCT.md` scaffold
  added at toolbench root (Mission, Audience, Brand & voice, Current
  focus, Stack, Quality bar, Repos, Glossary — Tom to fill in). New
  `src/main/doc/ProductDoc.ts` mirrors the CockpitDoc loader; Mucka
  picked up `get_product_doc(section?)`. `pm.md` gains a "Product —
  at a glance" block telling her to read PRODUCT.md before reviewing
  a PR or making confident product-direction calls. PR review tools:
  `read_pr_diff` (auto — fetches the diff via the GitHub REST API,
  capped at 40k chars) and `post_pr_review` (edit-confirm — submits
  approve / request-changes / comment via the `/pulls/{n}/reviews`
  endpoint, logs a job-sheet event). Tool count 31 → 34.
- **2026-05-15** — Text-mode Mucka migrated to the Claude Agent SDK.
  Auth now flows through the `claude` CLI (Pro/Max subscription) so
  ANTHROPIC_API_KEY is no longer required for text. Same prompt, same
  31 tools, same renderer flow (confirm strips, edit strips) — just a
  different engine. Old `MuckaText.ts` + `@anthropic-ai/sdk` direct
  dep retired. Chat header shows "text via Claude Code".
- **2026-05-15** — Cross-agent broadcast. `⌘⏎` in the Mucka chat input
  types the current draft into every running agent's primary terminal
  in parallel (plain Enter still goes to Mucka). New `broadcast:send`
  IPC handles the fan-out — logs a system job-sheet event with the
  preview + recipient list, returns which agents got it vs were
  skipped (no live shell). The chat placeholder shows the running-
  agent count so the shortcut is discoverable; a short orange flash
  above the input names recipients after a send. Mucka picked up a
  `broadcast_to_agents` tool (edit-confirm) with an optional comma-
  separated subset (defaults to every running agent). Tool count 30
  → 31. Prompt pushed via `mucka:sync`.
- **2026-05-15** — Roadmap kanban (slices 1–4). The middle-column
  "Roadmap" tab is now a 5-lane drag-and-drop kanban
  (Backlog · Next · Doing · Shipped · Parked) backed by a new
  `roadmap_cards` sqlite table. Cards have markdown bodies and image
  attachments saved under `<userData>/roadmap-attachments/<cardId>/`,
  served via a new `mucka-asset://` custom protocol. Click to view
  rendered markdown + image; Edit / Delete (confirm) in the same
  modal. Drag between columns or reorder within one. `## Roadmap` in
  MUCKA.md is auto-mirrored from sqlite on every change. Mucka picked
  up five tools: `list_roadmap`, `create_roadmap_card`,
  `update_roadmap_card`, `move_roadmap_card` (all auto), and
  `delete_roadmap_card` (confirm-gated). Tool count 25 → 30. Prompt
  pushed via `mucka:sync`.
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

## Roadmap

### Backlog

_(empty)_

### Next up

- **Cross-agent broadcast. One Mucka tool + a ⌘⏎ shortcut in**
  the chat input to fan the same prompt to all four (or a subset of)
  terminals. Workflow win when parallelising similar work.
- **Keyboard shortcuts. ⌘1-4 focus an agent's primary terminal,**
  ⌘K command palette, ⌘J jump to job sheet, ⌘N focus notes.

### Doing

_(empty)_

### Shipped

_(empty)_

### Parked

- **Mucka Pro worktree folder layout (parked 2026-05-14). Tom is**
  considering an umbrella Mucka Pro/ folder with a sibling main/ clone +
  four worktree subdirs (dave/, sammy/, kev/, bren/). The cockpit
  doesn't care about layout — each agent's worktreePath is an absolute
  path. Pick up when Tom has the worker agents actively running on Mucka
  Pro branches.
- **Worktree management UI (create / delete / rename from the cockpit).**
- **CI rerun shortcut (button per failed check via gh CLI).**
- **Agent presets (quickly swap an agent between projects/branches).**
- **Per-agent Mucka write tool — let Mucka edit MUCKA.md herself**
  rather than only reading it.
- **Proactive voice nudges (Tom explicitly skipped this — don't**
  re-propose without checking).


