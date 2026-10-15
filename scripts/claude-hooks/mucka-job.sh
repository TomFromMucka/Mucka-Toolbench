#!/usr/bin/env bash
#
# Lets the Claude in a Mucka Toolbench job start another job, for work it
# found that belongs in a PR of its own. Only once Tom has said yes to it (the
# job rules make the Claude ask him first) or asked for it himself: the
# cockpit starts the job as soon as it reads the file.
#
#   ~/.claude/mucka-job.sh start "Short title" <<'BRIEF'
#   The opening message for the new job's Claude, which knows nothing of
#   this job: what to do, why, where to look, how to know it's done.
#   BRIEF
#
# Writes ~/.claude/mucka-jobs/proposals/<id>.json; the cockpit's
# SpinoffWatcher reads it, removes it and starts the job. Nothing here
# touches git or types into a terminal. Only works in a job's terminal
# ($MUCKA_JOB is set there), so a new job always names the job it came from.

set -uo pipefail

die() { printf 'mucka-job: %s\n' "$1" >&2; exit 1; }

[ "${1:-}" = "start" ] || die 'usage: mucka-job.sh start "Title" < brief (only once Tom has said yes)'
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

printf 'Starting "%s" as a new job. Carry on with your own.\n' "$title"
