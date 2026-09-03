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
- Four or six agent clipboards — each a real node-pty + xterm.js
  terminal at its worktree. Settings → Agents → *Layout* switches
  between them: four sits in a 2×2 grid with the right-hand column
  (previews, Vercel, git) alongside; six goes 3×2 and hides that column
  to buy the width. Existing agents hold their seats across a switch, so
  running shells aren't disturbed. Names are editable per agent; ids are fixed
  (`dave`, `sammy`, `kev`, `bren`, `marlene`, `albert`).
- Tab strip per agent: `+` to split, `▶ preview` to kill any prior
  preview tab and spawn a fresh one that auto-types `npm run dev` and
  binds the detected `http://localhost:N` URL to the preview iframe.
- Status pill (top-right of each clipboard) flips between
  `idle` / `thinking` / `awaits Tom`, driven by what Claude Code reports
  about itself (see *Claude state* under Systems) rather than by reading
  the terminal.
- Model + context chips sit alongside the pill, reported by Claude Code
  itself — so the two things worth knowing at a glance survive a terminal
  too narrow to show the status line itself. The
  model name drops its parenthetical to fit (`Opus 5 (1M context)` →
  `Opus 5`, full name on hover); `ctx` counts *up* as the window fills
  and turns orange past 50%.
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
- Notes scratchpad — free-form textarea, 600 ms debounced autosave
  to sqlite, flushed on blur and ⌘S.
- Roadmap kanban — six lanes, drag-and-drop, cards open in a modal.
  **Issues** sits between Backlog and Next up and holds production
  errors off Sentry triage, nothing else, so it reads as a straight
  list of what's broken in production.
  **Send to worktree** on an open ticket picks an agent from a
  dropdown (idle ones first, running ones flagged as a restart),
  launches Claude Code in that worktree and pastes the ticket in as
  the opening prompt; the card moves to *Doing*.

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

**Mucka tools (44).**

Read-only (auto-execute):
- `list_agents`, `get_git_status`, `read_file`, `list_dir`, `get_diff`,
  `git_log`, `get_recent_output`,
  `whats_happening`, `get_recent_events`, `get_vercel_status`,
  `get_pr_status`, `get_cockpit_doc`, `get_product_doc`,
  `list_memories`, `get_memory`, `list_roadmap`, `read_pr_diff`,
  `list_sentry_issues`, `get_sentry_issue`.
- Plus the SDK's built-in `WebSearch` / `WebFetch` in text mode, so
  Mucka can research a ticket before writing it. Everything else
  built-in (Bash, Read, Write…) is still denied.

Chrome writes (auto-execute):
- `set_banner_status`, `append_note`, `flag_attention`,
  `clear_attention`, `set_agent_preview`, `remember`, `start_agent`,
  `create_roadmap_card`, `update_roadmap_card`, `move_roadmap_card`,
  `triage_sentry_issue`.

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
for the primary terminals only. Spawn is attach-or-create: it compares
the request against the live proc's command + args + cwd, reattaching
when they match so a remount can't restart a live session, and
respawning when a config edit changed them. A genuinely fresh process
comes from the explicit `restartAgent` IPC.

**Claude state (`src/main/claude/ClaudeStateWatcher.ts`).** Claude Code
reports on itself rather than the cockpit guessing. `~/.claude/mucka-agent-state.sh`
is wired into the statusline (which receives `.model.display_name` and
`.context_window.used_percentage` as JSON on every render) and into the
UserPromptSubmit / Notification / Stop / SessionEnd hooks, and merges both
into one JSON file per worktree under `~/.claude/mucka-state/`. Main
watches that directory and emits `agent:status` as before.

Bindings are exact where possible: the cockpit exports `MUCKA_AGENT` into
each PTY, so a Claude it launched names its own agent. Sessions started
elsewhere fall back to longest-prefix cwd matching, and an agent still
pointed at `$HOME` is skipped so it can't claim every unrelated session.
A `working` claim older than 90s is treated as idle, since a Claude killed
mid-turn never fires Stop.

This replaced heuristic scraping of the PTY stream, which could not work:
the TUI redraws in place, so the stream holds interleaved fragments
(`✻di113 tokens`, `✻ethinking`) and `esc to interrupt` appeared **zero**
times across four real scrollback buffers — which is why the status pill
sat on `idle` forever and Mucka's witnessed reply loop never fired.

**Database (`src/main/db`).** better-sqlite3, migrated idempotently
on boot. Tables: `agents`, `kv` (notes), `events` (job sheet, capped
500), `chat_messages` (capped 500, holds text + voice transcripts
with optional `source: 'voice'` segment tag).

**Event stream (`src/main/events`).** `logEvent({source, kind,
message, tone})` inserts + broadcasts. Sources: agent ids, `mucka`,
`system`. The job-sheet *panel* is gone (Tom never used it), but the
stream itself is load-bearing: it drives the per-agent headline, and
it is the audit trail for anything Mucka does unsupervised — Sentry
verdicts especially. She reads it back with `get_recent_events`.

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

- **2026-09-03** — Failures are visible. A terminal that can't spawn
  (pruned worktree, bad command) prints why in the pane instead of
  sitting blank; a notes save that fails flips the subtitle to *NOT
  SAVED* with the reason and keeps the text for ⌘S; Settings → Agents
  shows a save error in the footer and no longer wipes unsaved drafts
  when agents reload in the background; start/stop failures show on the
  clipboard. Scrollback replay now lands before any live chunk on a
  reattach, so a reconnected pane reads in order.
- **2026-09-03** — Pollers back off. Vercel, GitHub and Sentry each
  double their wait after a failed tick (capped at 10 / 15 / 30 min,
  with a longer floor on a 401/403) and reset on success, instead of
  hammering a revoked token every tick. One job-sheet line per failure
  streak says how long they're pausing. Manual refreshes ignore the
  pause. Helper in `src/main/net/Backoff.ts`.
- **2026-09-03** — Text-mode Mucka can be stopped. A `stop` button sits
  beside the typing indicator; it aborts the SDK turn, keeps whatever had
  already arrived (with a `(stopped)` tail) and releases the chat input,
  which previously stayed dead until a restart if a turn hung. Resume is
  safer too: the retry-without-session fallback now only fires when a
  turn failed before producing any output (the missing-session case), so
  a mid-turn network blip or tool error no longer replays executed tool
  calls or forks the conversation.
- **2026-09-03** — Mucka can read a worktree. Four auto-execute tools:
  `read_file` (line-numbered, paged), `list_dir`, `get_diff`
  (working / staged / branch-vs-main, optional path) and `git_log`
  (`branch_only` for unpushed commits). Main resolves every path against
  the agent's worktree root and refuses anything that escapes it,
  symlinks included (`src/main/worktree/WorktreeRead.ts`). Results are
  fenced as untrusted content like PR diffs. Run `npm run mucka:sync`
  so voice mode gets the schemas.
- **2026-09-03** — Delegate no longer pastes the ticket into a booting
  shell. Readiness now comes from Claude Code itself: main's
  `agents:await-claude` resolves when the statusline hook writes a state
  file newer than the agent's last restart (session id as tiebreak), and
  `dispatch.ts` waits on that instead of regex-matching the PTY stream —
  which was matching the *previous* session's prompt because scrollback
  survived the kill. An explicit kill (stop, restart, config change) now
  forgets the buffer; quit still persists it. A torn-down session's state
  file is ignored from the clear onward, so a stopped agent no longer
  flips back to "awaits Tom" on the next sweep. If nothing reports within
  20s the prompt still goes, with an event on the sheet naming the
  statusline hook as the likely gap.
- **2026-09-03** — Security hardening. Worker shells no longer inherit
  the cockpit's integration tokens (GitHub, Vercel, Sentry, ElevenLabs);
  preview tabs deny mic/camera/location and only load http(s); the main
  window runs sandboxed with only the typed `window.mucka` bridge;
  `shell.openExternal` is scheme-limited. Untrusted text handed to Mucka
  (agent output, Sentry titles/messages, PR diffs) is fenced as
  `<<<untrusted …>>>` and the prompt says to treat it as data, never
  instructions. Main's tool timeout now outlasts the confirm strip so a
  late approval can't double-fire. `npm audit fix` cleared the
  transitive MCP/express advisories.
- **2026-09-03** — Fixed text-mode Mucka 400ing on every turn. The Agent
  SDK ships its own vendored Claude Code binary, and the pin at
  `^0.3.142` gave us 2.1.142 — which rejected the `opus[1m]` default set
  machine-wide in `~/.claude/settings.json`. Bumped to `^0.3.258`, and
  pinned `MUCKA_TEXT_MODEL` in `.env` so Mucka no longer inherits a
  moving CLI default.

- **2026-08-29** — Fixed the in-app updater on locally-installed builds.
  `npm run install:mac` builds without `--publish`, and electron-builder
  only emits `Contents/Resources/app-update.yml` on a run that actually
  publishes — so a local install had no updater config and the update
  button failed with ENOENT before it ever reached GitHub. That is why
  0.5.0 sat un-updatable. The file is now seeded through
  `extraResources` so it lands *before* signing (adding it afterwards
  would break the code seal), and `install-mac.sh` refuses to install an
  app that is missing it.

- **2026-08-27** — The roadmap grew an **Issues** lane, between Backlog
  and Next up. Every card Mucka opens off a Sentry ticket verdict lands
  there and nothing else does, so the lane is a straight read of what's
  broken in production rather than bugs sinking into the idea pile.
  A regression on a shipped card comes back to Issues; sending an
  Issues card to a worktree still moves it to Doing.

- **2026-08-27** — The Sentry loop closes. The poller now also watches
  the issues Mucka has ticketed and hands her a turn when one *moves* in
  Sentry, not just when it appears: resolved → she moves the card to
  shipped, resolved-then-erroring-again → she pulls it back out of
  shipped and flags the operator, archived by hand → she decides what
  the card deserves. Last status lives on the `sentry_issues` row, so a
  change is reported as an edge rather than every five minutes, and an
  undelivered one survives the window being shut — a resolve overnight
  is still handed over at boot. The unresolved list the tick already
  fetched answers for free; only the quiet ones cost a request, twelve
  a tick, least-recently-checked first, so seventy-odd open tickets
  sweep inside the hour rather than hammering the API. The turn also
  carries the other issues on the same card and where each stands —
  a card covering a cluster isn't shipped because one of the cluster
  went quiet. The first read of any ticket is written down quietly: the
  seventy-odd tickets predating this all read "unresolved" by column
  default, and reporting the truth against that default would have
  handed her every already-fixed one at once. Ruling *ticket* stamps
  that baseline itself, so a fix landing minutes after the card is
  written still reports.

- **2026-08-16** — Dropped the Job Sheet tab; the middle panel is just
  the Roadmap now (`JobSheet.tsx` → `RoadmapPanel.tsx`, ~150 lines
  lighter). Events keep being recorded — they still feed the per-agent
  headline and Mucka's `get_recent_events`, which is how you audit
  unsupervised Sentry triage now that there's no feed on screen.

- **2026-08-13** — Terminals render on the GPU. xterm was on its DOM
  renderer (no WebGL/canvas addon) with `cursorBlink: true`, so six
  panes repainted through the compositor forever with no output at all
  — an idle cockpit measured 25% renderer + 25% GPU. Added
  `@xterm/addon-webgl` with a fallback to DOM on context loss, and
  turned the cursor blink off. The addon reaches into xterm internals
  and can fail to activate without throwing, which would put us quietly
  back on the slow path, so each pane now logs
  `[mucka] <id>: renderer = webgl | dom (fallback)` at startup — check
  the DevTools console after an update. The attention glow still
  animates `filter` (three drop-shadows, re-rasterised per frame) but
  only while an agent is flagged; it now honours
  `prefers-reduced-motion`. Note the idle burn is variable, not
  steady — sample it five times, not once.

- **2026-08-13** — Sentry issues triage themselves. A `SentryPoller`
  checks the org every five minutes, records anything new in sqlite
  (dedupe by issue id, so restarts can't re-report) and hands it to
  Mucka as a triage turn. She pulls the detail, then rules: *ticket*
  (writes a roadmap card, which already has a Send-to-worktree button),
  *noise* (archives it in Sentry), or *watch* (left alone so it comes
  back if it escalates). Auto-executes with no confirm strip — the
  guard is in code, not the prompt: anything with users affected or
  high priority can't be archived, and every verdict lands on the job
  sheet with the permalink. *Watch* is not a dead end — a watched issue
  is handed back for re-triage once it escalates (anyone newly
  affected, or events up 5× and +20), carrying what she said last time
  and the before/after numbers. Token, org slug and **region URL** go in
  Settings → API Keys; the region is the trap, since an EU org 404s
  every call against sentry.io and it reads as a bad token.

- **2026-08-12** — Tickets became launch prompts. An open roadmap card
  now has a **Send to worktree** button: pick an agent from the
  dropdown (idle grouped first, running ones warn that they'll be
  restarted) and the cockpit points it at Claude Code, restarts it and
  pastes the ticket in as the opening prompt, then moves the card to
  *Doing*. Prompts go in via bracketed paste, so a multi-line markdown
  body arrives as one block instead of one Enter per line — `delegate`
  and `send_to_agent` share the same path and got that fix too.
  Mucka's prompt now treats a ticket as the prompt an agent is launched
  with (interview first, then write to shape), and she has `WebSearch` /
  `WebFetch` in text mode to research before she writes.

- **2026-08-01** — Releases stopped half-publishing. electron-builder
  runs a publisher per artifact and they raced to create the GitHub
  release; the loser 422'd and aborted the run, killing the in-flight
  180MB zip while the small blockmap had already uploaded. Twice that
  shipped a release the updater could see but not download.
  `release:mac` now creates the release up front and verifies the zip +
  latest-mac.yml are actually present before declaring success, since
  electron-builder exits 0 on a partial upload.
- **2026-07-30** — Agent status actually works, and a waiting roll-call
  in the banner. Status came from pattern-matching the PTY stream, which
  cannot work against a TUI that redraws in place — `esc to interrupt`
  appears zero times in real scrollback, so every agent read `idle`
  forever (and Mucka's witnessed reply loop, which keys off busy →
  finished, never fired). Claude Code now reports its own activity, model
  and context through a statusline + hooks recorder; the cockpit watches
  the files. The banner names whoever is waiting on Tom, since a glow on
  one of six panels is easy to miss on an ultrawide.
- **2026-07-30** — Model + context chips in the agent header. A
  toolbench terminal is too narrow to show Claude Code's status line, so
  the two things worth knowing at a glance are lifted into the clipboard
  header instead. The existing `ctx` chip never populated because every
  pattern required the literal word "context" and a custom statusline
  emits `ctx:27%`; that percentage is also *used*, not remaining, so the
  chip's colour rule was inverted. Both fixed, and everything now
  normalises to used.
- **2026-07-30** — Terminals reattach instead of restarting. `spawnPty`
  used to kill whatever it found and start a fresh shell, so every
  renderer remount — layout change, tab reshuffle, dev HMR — silently
  restarted the agent and killed any running Claude session. Spawn now
  compares command + args + cwd against the live proc: same shell →
  reattach and resize; config edit → respawn as before. Restarting is
  explicit via a new `restartAgent` IPC, used by the `restart_agent`
  and `delegate` tools (which do want a fresh process).
- **2026-07-30** — Stray mouse-report input at the shell prompt fixed.
  Claude Code exits with mouse motion tracking still on
  (`?1000/1002/1003/1006h`), so replaying raw scrollback into a fresh
  xterm re-armed it and pointer movement typed `\x1b[<35;…M` garbage
  into the bare zsh prompt until you Ctrl-C'd. Terminals now switch
  every input-reporting mode back off after a scrollback replay, and
  again when a shell exits mid-TUI.
- **2026-07-30** — Optional six-terminal layout. Settings → Agents →
  *Layout* picks 4 (2×2 grid + right column) or 6 (3×2 grid, right
  column hidden). Existing agents keep their seats across a switch —
  six-up appends a third column rather than reflowing — so no clipboard
  is remounted and no terminal view is disturbed. Two
  agents added to the lineup (`marlene`, `albert`), seeded per-id so
  existing databases pick them up without losing configured rows.
  Hidden agents drop out of the explorer, Vercel and git panels too.
- **2026-06-19** — PM delegation + witnessed reply loop. New `delegate`
  tool stands a worker up in one signed-off step: set worktree → launch
  Claude Code → wait for its TUI → submit the task. When the PM messages
  a worker (delegate/send_to_agent) a one-shot watch arms; when that
  worker finishes its turn, its output is fed back into the PM chat
  automatically so the PM drafts a follow-up — which still pops the
  confirm strip for Tom's sign-off. Tom witnesses the whole exchange;
  every outbound PM→worker message is approved.
- **2026-06-18** — Persistent memory for the Mucka text agent. (1)
  Session resume: the SDK `session_id` is persisted and resumed on boot,
  so Mucka continues the actual prior conversation with full
  (auto-compacted) context instead of starting cold; falls back to a
  fresh session if the log is gone. (2) `recall` tool: keyword search
  across the stored transcript + older session summaries. (3)
  Auto-summaries: once enough new messages pile up, a background
  summarizer rolls them into a dated `conversation_summaries` row;
  recent summaries also load into the boot snapshot.
- **2026-06-18** — Panel resize overhaul + confirm UX. Every panel
  (agent terminals + chat/jobs/notes) now has a min/mid/max segmented
  control in its header; siblings reflow via grid weights. Minimised
  panels stay mounted (hidden via CSS) so terminals keep running and
  preserve their tabs/preview. Confirm strip moved inline into the chat
  (compact, no longer shoves the grid down); confirms now show the
  agent's display name, not the raw id.
- **2026-06-18** — Mucka text agent: unblock tools. The Agent SDK had no
  permission gate, so every `mcp__mucka__*` call stalled on "you haven't
  granted it yet" with no UI to approve. Now auto-allow cockpit tools at
  the SDK level (confirm-writes still gated by the renderer ConfirmStrip);
  inject a passive cockpit snapshot (agents + recent events) on the first
  turn of each boot; add a `self_test` diagnostic tool; and de-hardcode
  the worker names in the PM prompt (pull the lineup from `list_agents`).
- **2026-06-18** — Roadmap content is private: mirror writes to the
  git-ignored `ROADMAP.local.md`, not the tracked `MUCKA.md`.
- **2026-06-10** — Mucka text mode: fix the *remaining* `spawn ENOTDIR`
  in packaged builds. The SDK resolves its native `claude` binary via
  `createRequire(import.meta.url)`, which lands on the path inside
  `app.asar`; Electron's patched `fs` makes it look real but `spawn`
  can't traverse an asar. Now pass `pathToClaudeCodeExecutable`
  pointing at the `app.asar.unpacked` copy when packaged, and unpack
  the `claude-agent-sdk-*` platform packages explicitly.

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

The roadmap lives in the cockpit's kanban (sqlite) and is **private**.
This repo is public, so roadmap card content is deliberately kept out of
this tracked doc. A readable mirror is generated locally to the
git-ignored `ROADMAP.local.md`. Edit the board in the app.

