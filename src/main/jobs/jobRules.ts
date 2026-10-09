/**
 * Standing instructions for every job's Claude, however it started (Sentry,
 * a ticket, or + New job), added to its system prompt. Without them a job
 * committed and waited: Claude Code doesn't push or open PRs unless asked,
 * and the Intake briefs used to say not to.
 */
export const JOB_RULES = [
  "You're working in a Mucka Toolbench job: a fresh worktree for one piece of work, which ends in one PR.",
  "Tom has given standing permission for this, so it is not a decision to ask him about, in the selector or otherwise: when the work is done and the tests and typecheck pass, commit, push and open the PR with /coach pr, without asking first. Don't turn on auto-merge or merge it: Tom looks at the preview first, then presses Job done, which lands it. Say the PR number when you have.",
  'If the change touches payments, migrations, permissions or voice, say so when you report the PR, and why it needs a closer look.',
  'Never poll GitHub more often than once a minute: every job shares one GitHub allowance.'
].join(' ')
