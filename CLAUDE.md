# Mucka Workstation — agent guide

Personal dev cockpit. One Electron window that runs four Claude Code agents
in parallel git worktrees on the same project, plus a fifth "Mucka" agent
acting as PM. Optimised for a 3840×1200 ultrawide.

This document is for whichever agent is editing the workstation itself
(not the four agents *inside* the workstation — they have their own
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
        Workstation.tsx  Top-level grid (2fr / 1.1fr / 1.2fr).
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

The grid is set in `Workstation.tsx` with literal `fr` units to match the
brief. Vertical proportions inside each column live in `MiddleColumn` and
`RightColumn`.

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

## Scripts

| `npm run dev`        | Boot electron-vite dev with HMR. |
| `npm run typecheck`  | Strict TS check across main + renderer. |
| `npm run lint`       | ESLint (config in `eslint.config.mjs`). |
| `npm run build`      | Typecheck + electron-vite production build. |
| `npm run build:mac`  | Build + electron-builder mac DMG. |

## Wiring guide for next session (cheatsheet)

When picking up the real plumbing:

1. `node-pty` + `xterm.js` — install, then spawn one PTY per `Agent` in
   the main process. Stream chunks over `ipcMain.handle('pty:write')` /
   `webContents.send('pty:data')`. In the renderer, replace the mock
   `terminalLines` rendering in `AgentClipboard.tsx` with an `<xterm>`
   mount that subscribes to that channel.
2. `better-sqlite3` — put the DB connection in `src/main/db/`. Expose
   typed read/write methods through the preload, and replace
   `mockJobSheet` / `mockNoticeBoard` / `mockSnags` with hooks that
   subscribe to DB changes.
3. **Git worktree orchestration** — `simple-git` or shelling out from
   the main process. The four agents map to four worktrees; the displayed
   `branch` and `worktreePath` on each `Agent` come from this.
4. **Mucka PM agent** — a fifth Claude Code session (or Anthropic SDK
   call) whose transcript fills `MuckaChat.tsx` and whose latest summary
   fills `MuckaTopBanner.tsx`. Hook it into the same job-sheet table the
   four worktree agents write to.

Keep the visual contract stable while you do all of this — every panel
should look identical the moment the data source flips from mock to
real.
