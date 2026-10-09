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
- **A scout pass before that review.** A cheap model reads the diff first
  and flags anything suspicious for the independent review to dig into.
  Spotify's judge vetoes about a quarter of agent sessions this way before
  a human sees them; the point is to spend Tom's attention only on work
  that has already survived two looks.

**The Rule of Two (added 2026-10-07).** A job may have at most two of:
reading untrusted input, reaching sensitive systems, and making changes.
A support ticket is untrusted input, because a customer can write
instructions into it, so a ticket job never also holds both production
access and the ability to change code. In practice: the cockpit fetches
the named production reads for a ticket job and hands them over, and the
job itself has no database credentials. If a ticket needs a code fix, that
becomes a separate job whose input is Tom's own summary, not the ticket
text. Source: "How to build an AI-native software factory" (The AI
Thinker), which takes it from Meta's agent security guidance.

## Slices

Ship in slices with a commit between each, and pause for Tom's feedback
after the first visible change.

### Slice 1 — Needs you, with answer buttons (all layouts) (built 2026-10-07)

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

### Slice 3 — The Jobs layout shell (built 2026-10-07)

Add Jobs as a third value of `TerminalCount` (or a separate layout mode),
with the five-column grid above. To start with, each running agent is a
job, so this needs no new data model. The explorer follows the selection,
the right column is reused, and the terminal switches per job with
mount-once hiding.

### Slice 4 — Jobs as their own records (in progress)

Built (2026-10-07):
- **+ New job / ⌘N** creates a job: a fresh worktree in `<repo>-jobs/` on a
  `job/<date-time>` branch off the latest main, with `.env`, `.env.local`
  and `CLAUDE.local.md` copied in and `node_modules` cloned copy-on-write
  from any checkout installed from the same lockfile. Its terminal opens
  with Claude running in Tom's normal mode, and Tom starts the job by
  talking to it. Jobs are rows in a `jobs` table.
- **Fresh per job, not a pool** (decided with Tom). Measured on the 64GB
  M5 Pro: the clone takes ~13s and next to no disk; each job gets a clean
  folder and its own Claude history; Claude's memory is per repo, so
  nothing is lost; there's no six-job ceiling.
- **Jobs report in.** Job terminals carry `$MUCKA_JOB`, so a job's status
  lanes its card and its questions reach Needs you. The card is titled
  from Tom's first message, and a restarted terminal resumes its own
  conversation with `claude --continue`.
- **Sign-off bar** under each job's terminal. *Ship* tells the job's Claude
  to commit, open the PR and turn on auto-merge (Tom's call: auto-merge,
  not a PR he merges by hand). *Amend* puts the cursor in the terminal.
  Once the PR merges, *Finish* types `/coach job-done`, a new coach command
  (Mucka Pro PR #3305): finish's checks, then it removes the job's folder
  and branch, only once the PR has merged. Toolbench sees the folder go,
  marks the card finished, and keeps the terminal so Tom can read the
  report until he closes the card. *Dismiss* throws an unmerged job away
  after a native dialog that names what would be lost. Each job's PR is
  polled every minute, and again whenever its Claude stops.
- **Ship and Finish became one *Job done* button** (Tom, later the same
  day: shipping tends to happen in the conversation anyway). It asks the
  job's Claude to check for loose ends and stop if there are any;
  otherwise to open the PR with auto-merge if there isn't one, wait for
  the merge, and run `/coach job-done`.

- **No "trust this folder?" prompt in jobs, and nothing to build for it.**
  Tested on Claude Code 2.1.292: a worktree inherits trust from its repo's
  main checkout. `~/Mucka-Pro` is trusted, so every job folder is too.
  (A worktree of an untrusted repo does ask.)

Still to build:
- **Job metrics.** Each job records what it cost (Claude Code reports it to
  the status line), whether it ended in a merged PR, and whether that PR
  was later reverted. The article's measure is "sessions that end in a
  merged PR" and "cost per merged PR", with revert rate alongside, so it's
  visible which kinds of job are worth handing over.

Agent count stops being tied to screen seats. Ten is a screen limit, not a
job limit.

### Slice 5 — Intake

**Started 2026-10-07: Intake replaces the Needs you column in Jobs.** Tom's
call: with many jobs running, a question needs the context its terminal
gives (each option's explanation, typing an answer), and the Waiting lane,
⌘J and the banner already lead there. The column now lists unresolved
Sentry issues in the terminal's font. *Start job* opens a fresh job whose
Claude starts with the issue and the groundwork rules as its first
message (passed through the environment, not typed). Tickets join next.
The banner's Needs you cards stay, restyled to look like Claude's own
prompt, with each option's explanation.

**Tickets (Tom's calls, 2026-10-08): scout, then fix; reply after it's live.**
Intake polls `scripts/ticket.ts list --json` (Mucka Pro #3323) every five
minutes from a read-only `scout` checkout on the latest main. Every
ticket that arrives after the first look gets a brief from a scout Claude
run `--restricted --strict-mcp-config --permission-mode dontAsk`, with
Read/Grep/Glob and only `ticket.ts show` allowed. That gives it customer
text plus production reads, but no way to change code or reach anyone.
Measured: ~$0.18 and half a minute a ticket. Tickets already open at the
first look wait for a click, so the backlog isn't billed at once. Next:
*Start fix* (a job from the brief, with ticket and production tools
denied in its folder), then a support-reply draft once the fix is live,
for Tom to sign off before it's sent.

**Auto-start (Tom's call, 2026-10-07: up to a draft fix).** When Mucka's
triage rules a Sentry issue a *ticket*, a job starts on it by itself and
goes as far as a draft fix under the supervised scope; nothing is pushed
until Tom presses Job done. About five new issues arrive a day, so at most 3
Sentry jobs are open at once. A job counts until it's signed off, and the
rest queue in Intake, so a noisy day backs up instead of burying Tom. The
issue's text is fenced as untrusted data in the brief, because the job
can run with nobody watching. A switch in the Intake header turns it off.

**Toil first.** The first automatic intake is work where "done" can be
checked without judgement:
- dependency and security bumps flagged by `npm audit`
- CI failing on main
- flaky tests
- stale feature flags

These fit the unattended rules in Mucka Pro's
`docs/sentry-groundwork-rules.md` and earn trust cheaply. Then new Sentry
issues, building on `SentryPoller`, which already triages and spots
escalations. Support tickets come last, under the Rule of Two above,
building on `scripts/ticket.ts` and the `support-reply` skill.

### Later — cloud

Run Sentry groundwork on cloud machines so it continues with the lid shut.
Tickets stay local.

**Commute hand-off (parked 2026-10-07).** Tom's idea: at 5pm, press a button and
the jobs carry on in the cloud for the drive home, then come back to the
laptop. Claude Code 2.1.292 has both halves: `claude --cloud` starts a cloud
session, and `claude --teleport` pulls one back down. A running terminal can't
move, so this would be a checkpoint, not a migration. At a turn boundary, push
the job's branch and start a cloud session with a handover note. At home,
teleport it back into the job's folder. Secrets, production reads, previews,
MCP servers and Needs you all stay local. The alternative is an always-on
machine: Tom's old laptop is spare and could stay at the office running the
jobs (Claude Code supports self-hosted environments, via `--environment`). Tom
parked both; tethering is good enough for now.

## Capacity (estimates, to measure on the 64GB laptop)

- A job doing groundwork is mostly a waiting Claude session, about
  0.2–0.3GB. Roughly 10–15 at once should fit.
- The heavy steps queue anyway: typechecks through the per-machine slot
  limit (Mucka Pro #3235), and dev servers only for sign-off evidence.
- A job waiting for sign-off is a branch and notes, with no process.
- The real limits are Claude plan usage and Tom's sign-off rate.
