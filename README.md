# Mucka Toolbench

A personal dev cockpit. One Electron window that supervises four parallel
Claude Code agents working on the same project (in separate git worktrees),
plus a fifth "Mucka" PM agent.

Built for a 3840×1200 ultrawide display.

## Status

Visual shell only — runs in dev mode and shows the full paper-and-ink
cockpit with mock data. Real PTYs, sqlite, git worktrees, and PM-agent
wiring are next. See `CLAUDE.md` for the layout, brand system, and the
plan for the next session.

## Run it

```bash
npm install
npm run dev
```

The window opens at the work area of the primary display. The brand
attention-glow shows on Sammy's clipboard — he needs you.

## Stack

Electron · electron-vite · React 19 · TypeScript (strict) · Tailwind v4.
xterm.js + node-pty and better-sqlite3 ship in the next session.
