# Mucka Toolbench — agent guide

Personal dev cockpit. One Electron window that runs four or six Claude Code
agents in parallel git worktrees on the same project, plus a fifth "Mucka" agent
acting as PM. Optimised for a 3840×1200 ultrawide.

This document is for whichever agent is editing the toolbench itself
(not the worker agents *inside* the toolbench — they have their own
context).

## What is here today vs. what is coming

**Today (visual shell only):**

- Electron app boots full-screen at the work area of the primary display.
- The complete layout — top banner, agent grid, middle column, right column.
- All panels render from static mock data in `src/renderer/src/data/`.
- Sammy's clipboard has `needsAttention: true` so the brand orange
  attention-glow is visible — this is the primary motion the user sees
  when an agent needs a decision.

**Next session (real wiring — do NOT touch these yet):**

- Real terminals via **xterm.js + node-pty**, one PTY per agent worktree,
  spawned and proxied through IPC. The `AgentClipboard` mock body is a
  drop-in placement for an `<xterm.js>` mount.
- **better-sqlite3** in the main process for the job sheet, notice board,
  and snagging persistence. Shared types in `src/shared/types.ts` are
  already the contract.
- Real **git worktree** orchestration (creating, switching, branch state)
  from the main process. Surfaces in the Mucka banner and the agent
  headers.
- The Mucka chat panel becomes a real Claude conversation with the PM
  agent (tool-using).
- The two right-column previews load actual `http://localhost:300X` dev
  servers spawned by each agent's worktree.

## Project shape

```
src/
  main/            Electron main process (window lifecycle, soon: PTY hosts,
                   sqlite, git workers, dev server registry).
  preload/         contextBridge exposure into the renderer. Add agent-IPC
                   APIs here next session; keep them typed.
  renderer/        React app (the cockpit UI).
    src/
      App.tsx           Mounts <Workstation/>.
      main.tsx          Bootstrap + global stylesheet import.
      layout/
        Workstation.tsx  Top-level grid (columns depend on terminal count).
      components/        UI primitives + panels.
        Clipboard.tsx    Shared paper-and-ink primitive (wooden clip head
                         + cream paper body). Every panel uses it.
        AgentClipboard.tsx
        AgentGrid.tsx
        MuckaTopBanner.tsx
        MuckaChat.tsx    PM voice — brand orange bubbles.
        JobSheet.tsx     Lined paper activity log.
        NoticeBoard.tsx  Post-its on cork-ish backing.
        BrowserPreview.tsx  Fake address bar + iframe slot.
        SnaggingPanel.tsx   CI / type / lint / test items.
        Middle/RightColumn.tsx  Vertical stacks.
      data/              Static mock data — REPLACE WITH IPC NEXT SESSION.
      styles/index.css   Tailwind v4 + brand tokens + @utility layer.
  shared/          Cross-process TypeScript types (renderer + main both
                   import from here via the @shared alias).
```

Path aliases (configured in `electron.vite.config.ts` and both tsconfigs):

- `@renderer/...` → `src/renderer/src/...`
- `@shared/...`  → `src/shared/...`

## Brand system — non-negotiables

Reach for the existing tokens in `src/renderer/src/styles/index.css`. Do
not freestyle hex codes in components.

| Token | Use |
| --- | --- |
| `bg-wood-deep` `#1a1612` | Outermost backdrop, the deepest shade. |
| `bg-wood-soft` `#2a2520` | Main workshop wood under panels. |
| `wood-grain` (utility) | Backdrop with wood grain striping. |
| `bg-paper-cream` `#f5f0e6` | Default paper surface. |
| `paper-lined` (utility) | Cream paper with notebook ruled lines. |
| `paper-grid`  (utility) | Cream paper with light grid. |
| `paper-plain` (utility) | Cream paper, faint top-light wash. |
| `clip-header` (utility) | Wooden clip header gradient on each Clipboard. |
| `text-ink` / `ink-soft` / `ink-faint` | The ink scale. |
| `text-mucka` / `bg-mucka` `#FF4E00` | Mucka PM voice. |
| `attention-glow` (utility) | Orange ring + pulsing halo. **Only** for an
  agent or item needing Tom's attention. |

Two hard rules:

1. **Brand orange `#FF4E00` is reserved.** It means "Mucka is speaking" or
   "something needs Tom". Never use it for ornamentation, hover states, or
   incidental highlights.
2. **Paper-and-ink texture, dark wood frame.** Every information surface
   is a Clipboard. If you need a new panel, compose it from
   `<Clipboard />` — don't invent a new chrome.

Fonts:

- `var(--font-display)` Caveat — clip-header titles.
- `var(--font-hand)`    Patrick Hand — body copy on paper.
- `var(--font-sans)`    System UI — incidental chrome.
- `var(--font-mono)`    System mono — terminal output.

## Layout shape (the cockpit)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Mucka top banner — orange · PM status line                           │
├───────────────────────┬─────────────────┬────────────────────────────┤
│ Dave  │ Sammy* (glow) │ Mucka chat      │ Preview left   (dev srv 1) │
├───────┼───────────────┤ Job sheet       ├────────────────────────────┤
│ Kev   │ Bren          │ Notice board    │ Preview right  (dev srv 2) │
│                       │                 ├────────────────────────────┤
│  2 fr                 │  1.1 fr         │ Snagging list   1.2 fr     │
└───────────────────────┴─────────────────┴────────────────────────────┘
```

In six-terminal mode (Settings → Agents → *Layout*) the agent grid goes
3×2 and the right column drops out entirely:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Mucka top banner                                                     │
├──────────────────────────────────────────────┬───────────────────────┤
│ Dave    │ Sammy   │ Marlene                  │ Mucka chat            │
├─────────┼─────────┼──────────────────────────┤ Job sheet             │
│ Kev     │ Bren    │ Albert                   │ Notes                 │
│  3.2 fr                                      │  1.1 fr               │
└──────────────────────────────────────────────┴───────────────────────┘
```

Seats are a fixed table (`AGENT_SEATS` in `AgentGrid.tsx`), not derived
from the column count: the first two columns keep the 2×2 pairing and
six-up only appends a third column. Don't "simplify" this into an index
calculation — a clipboard that changes position remounts, and a remount
discards the xterm (scrollback replay, "reconnected" banner, split tabs
collapsing back to one).

The grid is set in `Workstation.tsx` with literal `fr` units to match the
brief. Vertical proportions inside each column live in `MiddleColumn` and
`RightColumn`. The count lives in `state/LayoutContext.tsx`
(localStorage-backed) — `useLayout()` for the shape, `useVisibleAgents()`
for the agents the current layout has room for. Any panel that lists
agents must use `useVisibleAgents()`, not `useAgentsState().agents`,
or it will show agents whose terminals aren't on screen.

## Living spec — `MUCKA.md`

The cockpit has a living spec at `MUCKA.md` (project root). It covers:
*Mission*, *Capabilities*, *Systems*, *Recent changes* (rolling log),
and *Roadmap*. Mucka pulls it on demand via her `get_cockpit_doc` tool
so she can speak to current state and suggest priorities — it's
**not** baked into her prompt.

**Convention — update it as you ship.** Any session that lands a
user-facing change to the cockpit (a new tool, a new panel, a
behaviour change, a refactor with surface impact) appends a one-line
entry to *Recent changes* with today's date, and edits *Capabilities*
or *Systems* if the change adds or changes a feature there. Move
shipped roadmap items out of *Roadmap → Next up* into *Recent
changes* in the same edit. Keep entries terse — one bullet, one
sentence.

This keeps the doc honest without ceremony, and Mucka's answers stay
in sync with reality without anyone having to remember to "tell" her.

## Conventions

- **TypeScript strict** is on, with `noImplicitAny: true`. Don't loosen
  this without a reason.
- **No `any`, no `as` unsafe casts.** Mock data is fully typed against
  `src/shared/types.ts` and real wiring should produce the same shape.
- **No comments restating WHAT.** Names should do that. Only comment the
  WHY when it's a non-obvious constraint.
- **Don't grow a component library.** Compose from `Clipboard` and inline
  Tailwind. We're not building a design system, we're building a tool.
- **Keep mocks isolated.** Everything fake lives under
  `src/renderer/src/data/`. When you wire IPC, swap a `data/` file for a
  `useAgents()` hook backed by `window.api` — leave the shape intact so
  components don't change.
- **Don't put PTY, sqlite, or git into the renderer.** Those belong in
  `src/main` and reach the renderer only through preload-exposed,
  contextBridge-typed APIs. The renderer process is sandbox-adjacent and
  must stay simple.
- **Never infer agent state by reading the PTY stream.** Claude Code's
  TUI redraws in place, so the stream is interleaved fragments — cues
  like `esc to interrupt` never appear contiguously (zero matches across
  four real scrollback buffers). Anything you want to know about a
  running Claude comes from `~/.claude/mucka-agent-state.sh`, which the
  statusline and the UserPromptSubmit / Notification / Stop hooks feed,
  and which `ClaudeStateWatcher` reads. Extend that instead of adding
  another regex.
- **`spawnPty` is attach-or-create, and restarting is explicit.**
  `PtyManager.spawn` compares the request against the live proc's
  signature (command + args + cwd): same shell → reattach and resize;
  different shell (a config edit) → kill and respawn. So mounting a
  terminal is always safe, and anything that genuinely wants a fresh
  process calls `restartAgent` (kills the agent's shells, leaves it
  running) and *then* bumps the restart version to force the remount.
  Don't reintroduce "remount means restart" — a layout change or an HMR
  reload would silently kill live Claude sessions.

## Scripts

| `npm run dev`        | Boot electron-vite dev with HMR. |
| `npm run typecheck`  | Strict TS check across main + renderer. |
| `npm run lint`       | ESLint (config in `eslint.config.mjs`). |
| `npm run build`      | Typecheck + electron-vite production build. |
| `npm run build:mac`  | Build + electron-builder mac DMG. |
| `npm run mucka:sync` | Create-or-update the Mucka PM agent + push prompt. |

## Mucka the PM agent

The fifth agent lives in the top banner. Powered by ElevenLabs
Conversational AI — Tom toggles a session with the voice button (or
`⌘M`), Mucka responds in voice and as bubbles in the `MuckaChat` panel.

**Prompt is source-of-truth in the repo.** Edit
`src/main/mucka/prompts/pm.md`, run `npm run mucka:sync -- --dry-run` to
diff against the live agent, then `npm run mucka:sync` to push. Never
edit the prompt in the ElevenLabs dashboard — the next sync overwrites
it.

The `--` is not optional: `npm run mucka:sync --dry-run` swallows the
flag and performs a **real sync**.

**Check for a local override before editing the repo prompt.** If
`~/.mucka-toolbench/prompts/pm.md` exists, the sync pushes *that* and
ignores the repo copy — it says so in the first line of its output.
On a machine with an override, editing only the repo file changes
nothing about the live agent; the edit has to land in both.

**Env vars (read by main process only):**

Stored in `.env` at the project root (git-ignored). Copy
`.env.example` → `.env` and fill in:

- `ELEVENLABS_API_KEY` — your account key.
- `MUCKA_AGENT_ID` — the Conv AI agent id. Leave unset on first run;
  `mucka:sync` creates the agent and prints the id to add to `.env`.
- `ELEVENLABS_MUCKA_VOICE_ID` — the voice id from your ElevenLabs Voice
  Library. Required on first create; used by `mucka:sync` to (re-)set
  the agent's voice on any run.

`.env` is loaded via `dotenv/config` at the top of `src/main/index.ts`
and the `mucka:sync` script. If creds are missing the rest of the
cockpit keeps working — the voice button shows the reason as a tooltip.

**Architecture.** Mucka runs in the renderer via `@elevenlabs/react`
(`useConversation`). Signed URLs are minted in main from
`src/main/mucka/Mucka.ts` so the API key never reaches the renderer.
`src/renderer/src/mucka/MuckaSessionContext.tsx` wraps the SDK,
exposes state to the rest of the app via `useMuckaSession()`, and
guards against double-start / stop-during-connect races. macOS mic
TCC prompt is triggered through `mucka:requestMic` IPC the first time
the user starts a session.

**Tools (later phases).** Voice-only client tools that touch local
state (PTY, sqlite, git, scrollback) belong in
`src/renderer/src/mucka/tools/` and are registered with `startSession`
via the `clientTools` map; the dashboard tool name must match the
handler name exactly (case-sensitive). For tools that mutate state and
write to a real shell, render a `ConfirmStrip` before executing.
Chrome tools (banner status, notice board, attention flag) auto-execute.

## Wiring guide for next session (cheatsheet)

The cockpit's real plumbing is now in place — PTYs, sqlite, git, voice.
Future sessions add Mucka tools (phase 2+), the right-column previews,
and any cloud integrations.
