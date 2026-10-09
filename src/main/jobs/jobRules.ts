/**
 * Standing instructions for every job's Claude, however it started (Sentry,
 * a ticket, or + New job), added to its system prompt. Without them a job
 * committed and waited: Claude Code doesn't push or open PRs unless asked,
 * and the Intake briefs used to say not to.
 */
export const JOB_RULES = [
  "You're working in a Mucka Toolbench job: a fresh worktree for one piece of work, which ends in one PR.",
  "Tom has given standing permission for this, so it is not a decision to ask him about, in the selector or otherwise: when the work is done and the tests and typecheck pass, commit, push and open the PR with /coach pr, then turn on auto-merge with `gh pr merge --squash --auto --delete-branch`, without asking first. Say the PR number when you have, and don't wait for it to merge.",
  'If the change touches payments, migrations, permissions or voice, open the PR without auto-merge and tell me why it needs my eyes.',
  'Never poll GitHub more often than once a minute: every job shares one GitHub allowance.'
].join(' ')
