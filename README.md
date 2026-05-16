# Mucka Toolbench

A personal dev cockpit. One Electron window that supervises four parallel
Claude Code agents working on the same project in separate git worktrees,
plus a fifth "Mucka" PM agent (voice + text) coordinating them.

Built for a 3840×1200 ultrawide. Works on smaller screens but the layout
is happiest with horizontal room.

## What's in it

- Four agent panels with real xterm.js terminals backed by node-pty —
  each in its own git worktree, with attention glow + context-window
  chip + per-column expand/collapse.
- A "Mucka" PM agent in the top banner — voice (ElevenLabs Conv AI) and
  text (Claude Agent SDK). 30+ tools spanning read (git, Vercel, PRs,
  memories, roadmap, the cockpit's own living spec) and write (banner
  status, attention flags, agent control, PR reviews, deploys,
  cross-agent broadcast).
- A kanban roadmap with markdown tickets + image attachments. The PM
  agent can create/edit/move/delete cards.
- A live dual preview pane that loads each agent's dev server with
  device-viewport presets (iPhone, iPad, Android, desktop) and
  persistent logins.
- A VSCode-style file explorer with right-click new/rename/delete and
  ⌘-click URL opens in terminals.
- In-app auto-updater via GitHub Releases.

For the full architecture + capability map see [`MUCKA.md`](MUCKA.md).
For agent-side conventions when editing the toolbench itself see
[`CLAUDE.md`](CLAUDE.md).

## Requirements

- macOS (Apple Silicon or Intel). Build scripts are Mac-only; the
  Electron app itself runs on Linux/Windows but install scripts and
  signing are macOS-shaped.
- Node 22+.
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview)
  installed and logged in (`claude login`). Text-mode Mucka uses your
  Claude Code subscription via the Claude Agent SDK — no API key
  needed.
- *Optional* — an [ElevenLabs](https://elevenlabs.io) account for
  voice-mode Mucka. Without it, voice mode shows a "configure"
  state and text mode still works.
- *Optional* — Vercel + GitHub PATs for the deployment + PR panels.

## Quickstart

```bash
git clone https://github.com/TomFromMucka/Mucka-Toolbench.git
cd Mucka-Toolbench
npm install
cp .env.example .env       # fill in the ones you've got, leave the rest blank
npm run dev
```

The cockpit boots with four idle agents. Press *Start* on any of them
to spin up a shell in a worktree. Use the Mucka chat panel (top right)
to ask the PM agent what's happening.

## Install as a Mac app

```bash
npm run install:mac
```

Builds + code-signs + drops a `Mucka Toolbench.app` into `/Applications`.
After install, drop a copy of your `.env` at
`~/Library/Application Support/mucka-toolbench/.env` so the packaged
app finds it. From then on, end-of-day updates are one command:

```bash
npm run install:mac
```

In-app updates (once a release is on the repo) live under
**Settings → Updates → Check for updates**.

## Personalising it

The repo ships a generic PM agent prompt and a blank product context
scaffold. To personalise without forking, drop your own copies at:

- `~/.mucka-toolbench/prompts/pm.md` — your PM agent's voice, hard
  rules, anything you want her to know that you'd rather not commit.
- `~/.mucka-toolbench/PRODUCT.md` — your product's mission, audience,
  brand & voice, current focus, quality bar. Mucka reads it on demand
  via `get_product_doc` to ground PR reviews and roadmap suggestions.

The cockpit reads these first and falls back to the shipped scaffolds
when absent. Useful for forks: your roadmap and brand strategy stay
local.

To push your prompt to your ElevenLabs Conv AI agent after editing:

```bash
npm run mucka:sync               # creates the agent on first run, updates on later runs
npm run mucka:sync -- --dry-run  # diff vs live without writing
```

The script refuses to overwrite a non-empty live prompt with the shipped
generic if your override is missing — pass `--use-bundled-prompt` to
force.

## Stack

Electron 39 · electron-vite · React 19 · TypeScript strict · Tailwind v4
· xterm.js + node-pty · better-sqlite3 · electron-updater · ElevenLabs
React SDK · Claude Agent SDK · @dnd-kit · react-markdown.

## Caveats

This is a personal tool, shared in the open. No support SLA, no
roadmap commitments, and the brand colour (`#FF4E00` accent on the
voice agent) is reserved-by-convention not by license. Fork freely.
