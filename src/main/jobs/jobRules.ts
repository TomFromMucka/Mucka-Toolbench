/**
 * Standing instructions for every job's Claude, however it started (Sentry,
 * a ticket, or + New job), added to its system prompt. Without them a job
 * committed and waited: Claude Code doesn't push or open PRs unless asked,
 * and the Intake briefs used to say not to.
 */
export const JOB_RULES = [
  "You're working in a Mucka Toolbench job: a fresh worktree for one piece of work, which ends in one PR.",
  "Tom has given standing permission for this, so it is not a decision to ask him about, in the selector or otherwise: when the work is done and the tests and typecheck pass, commit, push and open the PR with /coach pr, without asking first. Say the PR number when you have.",
  "Don't merge on your own: Tom looks at the preview first. When he tells you to merge (merge, merge it, ship it, land it), that is his yes, so do it then without asking again: `env -u GH_TOKEN -u GITHUB_TOKEN gh pr merge <number> --squash`. Leave out --delete-branch: gh then tries to check out main, which another worktree holds, and fails after the merge has already happened. Then run /coach job-done.",
  'If the change touches payments, migrations, permissions or voice, say so when you report the PR, and why it needs a closer look.',
  'Never poll GitHub more often than once a minute: every job shares one GitHub allowance.',
  "If you come across work that belongs in a PR of its own (a separate bug, or a follow-up this PR shouldn't grow to include), don't do it here, and never start a job for it on your own. Ask Tom with AskUserQuestion whether to spin it off as a new job, giving the title and one line on why. Only when he says yes, or when he asks you for a new job himself, start it with `~/.claude/mucka-job.sh start \"<short title>\"`, with the brief on stdin (a quoted heredoc). It starts straight away. Write the brief as the opening message for a fresh Claude that knows nothing of this job: what to do, why, where to look, and how to tell it's done. Then carry on with your own job."
].join(' ')
