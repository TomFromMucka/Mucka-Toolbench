#!/usr/bin/env bash
#
# Lets the Claude in a Mucka Toolbench job propose another job, for work it
# found that belongs in a PR of its own. The proposal lands in the cockpit's
# Intake, under *spin-offs*, and Tom starts it with one tap: nothing here
# starts a job, touches git or types into a terminal.
#
#   ~/.claude/mucka-job.sh propose "Short title" <<'BRIEF'
#   The opening message for the new job's Claude, which knows nothing of
#   this job: what to do, why, where to look, how to know it's done.
#   BRIEF
#
# Writes ~/.claude/mucka-jobs/proposals/<id>.json; the cockpit's
# SpinoffWatcher reads and removes it. Only works in a job's terminal
# ($MUCKA_JOB is set there), so a proposal always names the job it came from.

set -uo pipefail

die() { printf 'mucka-job: %s\n' "$1" >&2; exit 1; }

[ "${1:-}" = "propose" ] || die 'usage: mucka-job.sh propose "Title" < brief'
[ -n "${MUCKA_JOB:-}" ] || die "not in a Mucka Toolbench job's terminal, so there's no job to spin this off from"
command -v jq >/dev/null 2>&1 || die 'jq is needed'

title=$(printf '%s' "${2:-}" | tr '\n' ' ' | sed 's/^ *//; s/ *$//')
[ -n "$title" ] || die 'give the new job a title'
[ "${#title}" -le 120 ] || die 'keep the title under 120 characters'

brief=$(cat)
[ -n "$(printf '%s' "$brief" | tr -d '[:space:]')" ] || die 'the brief goes on stdin and must not be empty'
[ "${#brief}" -le 20000 ] || die 'keep the brief under 20,000 characters'

dir="$HOME/.claude/mucka-jobs/proposals"
mkdir -p "$dir"
id="p-$(date +%s)-$$"
jq -cn --arg id "$id" --arg parent "$MUCKA_JOB" --arg title "$title" --arg brief "$brief" \
  --argjson at "$(($(date +%s) * 1000))" \
  '{id: $id, parent: $parent, title: $title, brief: $brief, at: $at}' > "$dir/$id.tmp" \
  && mv -f "$dir/$id.tmp" "$dir/$id.json" || die "couldn't write the proposal"

printf 'Proposed "%s". It is in the cockpit for Tom to start; carry on with your own job.\n' "$title"
