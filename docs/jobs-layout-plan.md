# Jobs layout — plan

Status: plan, not started. Branch `feat/attention-queue`. Written 2026-10-06.

Mocks:
- Jobs layout on the 3840×1200 screen: https://claude.ai/artifact/HKoU3MwR1LZYYT8BzZCkPi
- Earlier brief and queue options: https://claude.ai/artifact/8nSHjrHjQGpHqt1wCiYHig

## What this is

A third layout, **Jobs**, alongside the existing four- and six-terminal
layouts. Tom picks it in Settings → Agents → *Layout*. The 4 and 6 layouts
stay exactly as they are.

The 4 and 6 layouts are organised around **seats**: one terminal per agent,
always on screen. Jobs is organised around **work**: Sentry issues,
support tickets and Tom's own requests become jobs. Groundwork runs on
them without Tom. His attention goes on answering questions and signing
off. He watches one job at a time, in a full terminal, when he engages
with it.

Two complaints this answers:

1. **Which agent needs me, and in what order?** Every waiting agent gets
   the same glow today. At ten that means scanning the whole grid.
2. **What is each one building?** The header shows the branch name and
   nothing about what was asked or where the agent has got to.

## The Jobs layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Mucka banner · summary line · talk · needs-you count · memory · typecheck slots · usage │
├──────┬───────────┬──────────────────┬───────────────────────────┬────────────────────┤
│Files │ Needs you │ Job board        │ Job terminal              │ Mucka chat         │
│(job's│ questions │ Coming in        │ Claude's replies,         │ Roadmap            │
│ work-│ first,    │ Groundwork       │ tool calls, thinking      │ Notes              │
│ tree)│ then      │ On the tools     │ [Terminal | Evidence]     │                    │
│      │ sign-offs │ Sign off         │ sign-off bar              │                    │
├──────┴───────────┴──────────────────┴───────────────────────────┴────────────────────┤
│ Crew dock · what each crew member is on · warm spares · ⌘J next · ⌘N new job          │
└──────────────────────────────────────────────────────────────────────────────────────┘
  280px    ~13fr        ~24fr              ~33fr                       ~22fr
```

- **Files** is the existing `ExplorerPanel`. It follows the selected job's
  worktree, marks the files the job added or changed, and still collapses
  to 40px.
- **Needs you** lists agents blocked on a question (oldest first), then
  finished work waiting for sign-off (oldest first). Only the first card
  gets `attention-glow`. Questions are answered with buttons.
- **Job board** has four columns: Coming in → Groundwork → On the tools →
  Sign off. Duplicates merge (a ticket and a Sentry issue are often the
  same bug).
- **Job terminal** is the selected job's real Claude session: the
  existing xterm, not a re-rendering of it. An *Evidence* tab holds the
  preview recording, the before/after test, the checks and the draft
  customer reply. A bar under the terminal offers Ship / Amend / Dismiss.
  Amend puts the cursor in the terminal.
- **New job** (⌘N) opens a fresh terminal in plan mode. Claude asks its
  questions there. Approving the plan puts the job on the board.
- **Right column** is the six-up right column unchanged: `MuckaChat`,
  `RoadmapPanel`, `NotesPanel`. Roadmap cards link to the jobs working on
  them, and Mucka can start a job from chat.

Tom's correction, which this plan must keep: **the terminal stays.** When
he works on a job he reads Claude's replies, and sometimes the thinking.
Cards and buttons are for triage, not a replacement for the terminal.

### Terminals in Jobs mode

Only the selected job's terminal is on screen. The others keep running in
main, and `spawnPty` is attach-or-create, so switching jobs reattaches
rather than restarts. A reattach replays scrollback, and a remount drops
split tabs (see the seat rule in `CLAUDE.md`). Switching between jobs must
use the same mount-once approach the seat table uses: keep each job's
xterm mounted and hide the others, rather than remounting on every click.

## Groundwork rules

Intake and groundwork come later (slice 5), but the rules are fixed now so
nothing built earlier contradicts them:

- Groundwork is read-only investigation: stack trace, affected customers,
  relevant code, recent changes, earlier fixes. For tickets, a draft
  reply.
- **A fix is drafted only after a test reproduces the bug.** Without a
  failing test, the job stops at evidence and says so.
- **No-go areas stop at evidence:** payments, migrations, permissions,
  voice. The full list comes from the Codex Sentry-fixer spec
  (`docs/sentry-groundwork-rules.md` in Mucka Pro, PR #3259).
- Nothing reaches a customer or production without Tom's sign-off. A
  ticket reply is still sent with `scripts/ticket.ts reply --send`.
- Ticket work stays local, because tickets carry customer data. Sentry
  groundwork needs only code and Sentry, so it could later run in the
  cloud.

**Stop point — decided 2026-10-06: supervised scope.** Mucka Pro's
`docs/sentry-groundwork-rules.md` (PR #3259) governs *unattended* fix
attempts, which are only allowed in allowlisted pure web helpers. Jobs is
supervised: Tom signs off before anything ships. So a Jobs agent may draft
a fix anywhere outside the no-go areas, once a test reproduces the bug.
The no-go areas still stop at evidence in Jobs too.

Two gaps the #3259 review found, which the build must close:

- **Production reads are named, not open-ended.** Ticket groundwork reads
  the live database (`scripts/ticket.ts`, and the account's settings).
  Each job kind lists the reads it is allowed to make. Anything else is a
  question to Tom, not a read.
- **An independent review before sign-off.** A drafted fix gets a second
  agent's review: a fresh session that sees the evidence and the diff,
  but not the first agent's reasoning. Its verdict goes on the Evidence
  tab. Tom's sign-off is the final check, not the only one.

## Slices

Ship in slices with a commit between each, and pause for Tom's feedback
after the first visible change.

### Slice 1 — Needs you, with answer buttons (all layouts)

This is the first build because it helps in 4 and 6 today, and Jobs reuses
it unchanged.

**What Tom sees**
- In 4 and 6: the existing `AttentionRollCall` in the banner opens into a
  Needs-you list. In Jobs: the Needs-you column.
- Each card shows: agent name, what it's asking, how long it has waited,
  and the answer as buttons. "Open terminal" focuses the agent.
- Order: blocked first, then sign-off, oldest first within each. Only the
  first card glows. Every other waiting agent gets a quiet number.
- ⌘J jumps to the next agent in the queue.

**Where the data comes from** (hooks only, never the PTY stream)

The hook payloads, from https://code.claude.com/docs/en/hooks.md:

| Hook | Gives us |
| --- | --- |
| `Notification`, `notification_type: permission_prompt` | The agent is blocked on a permission. `message` is the summary line. |
| `PreToolUse` | `tool_name` and `tool_input` for the call about to run, so the card can show the actual command. |
| `PreToolUse`, matcher `AskUserQuestion` | `tool_input.questions[]` with `question`, `header`, `options[].label/description`, `multiSelect`. Enough to render the options as buttons. |
| `PermissionRequest` | `tool_name`, `tool_input`, `permission_suggestions`. Can return `allow` / `deny` (and rule updates). |
| `UserPromptSubmit` | `prompt`, for the brief in slice 2. |
| every hook | `transcript_path`, the session's JSONL transcript. |

`~/.claude/mucka-agent-state.sh` gains a `pending` field: kind
(permission / question), the tool and its input or the questions, and
the time it started. `ClaudeStateWatcher` already reads this file and
needs no new watcher.

**How a button answers**

Two routes, decided by a spike before the build:

1. **Keystrokes (default).** The button sends the option's number through
   the existing `writePty` channel, as if Tom typed it. The terminal stays
   the single source of truth, and he can still answer there instead.
   Guard: only send if the agent is still waiting on *that same* pending
   item. If he has already answered in the terminal, a late click does
   nothing. A stray "1" landing in a live prompt is the failure to avoid.
2. **Hooks.** A `PermissionRequest` hook (or `PreToolUse` on
   `AskUserQuestion`, returning `updatedInput.answers`) waits for
   Toolbench's answer and replies to Claude directly. This is cleaner and
   doesn't depend on the dialog's key layout. **Unknown:** the docs don't
   say whether the terminal dialog is still shown, and still answerable,
   while the hook waits. If it isn't, this route takes the terminal away
   from Tom, which he has ruled out.

**Spike (half a day):** in a scratch session, register a
`PermissionRequest` hook that sleeps for 60 seconds, and check whether the
dialog appears and accepts a keypress while it sleeps. Do the same for
`AskUserQuestion`, and check which keys select its options. Adopt route 2
only if the terminal keeps working. Otherwise ship route 1.

Buttons write to a live shell, so `CLAUDE.md`'s ConfirmStrip rule applies.
The button itself is the confirmation, and its label must say exactly what
gets sent ("Yes", "Yes, don't ask again for supabase commands").

**Done when**
- A permission prompt in any agent appears as a card within about a second,
  showing the real command.
- Yes / Yes-always / No each produce the same result as typing it.
- Answering in the terminal removes the card. A late click on a removed
  card does nothing.
- An `AskUserQuestion` from an agent appears with its options as buttons.
- Only one glow at a time. ⌘J moves through the queue.

### Slice 2 — The brief on each terminal

A "what" line (PR title, else a readable branch name, else Tom's own title)
and a "now" line: a short summary of Tom's last instruction, or of the
pending question. The summary comes from a cheap model (Haiku) run on the
`UserPromptSubmit` prompt. Shown on each terminal header in 4 and 6, and on
job cards in Jobs.

### Slice 3 — The Jobs layout shell

Add Jobs as a third value of `TerminalCount` (or a separate layout mode),
with the five-column grid above. To start with, each running agent is a
job, so this needs no new data model. The explorer follows the selection,
the right column is reused, and the terminal switches per job with
mount-once hiding.

### Slice 4 — Jobs as their own records

- A `jobs` table in sqlite: source, title, stage, the agent and worktree
  doing it, timestamps.
- One short-lived worktree per job, built on the existing
  `slot/<name>` parking.
- Two warm spares kept on `origin/main` so a new job doesn't wait for an
  install.
- ⌘N new job in plan mode.
- Sign-off ends with the `/coach finish` ritual.

Agent count stops being tied to screen seats. Ten is a screen limit, not a
job limit.

### Slice 5 — Intake

New Sentry issues become jobs, building on `SentryPoller`, which already
triages and spots escalations. Then support tickets, building on
`scripts/ticket.ts` and the `support-reply` skill. Groundwork follows the
rules above.

### Later — cloud

Run Sentry groundwork on cloud machines so it continues with the lid shut.
Tickets stay local.

## Capacity (estimates, to measure on the 64GB laptop)

- A job doing groundwork is mostly a waiting Claude session, about
  0.2–0.3GB. Roughly 10–15 at once should fit.
- The heavy steps queue anyway: typechecks through the per-machine slot
  limit (Mucka Pro #3235), and dev servers only for sign-off evidence.
- A job waiting for sign-off is a branch and notes, with no process.
- The real limits are Claude plan usage and Tom's sign-off rate.
