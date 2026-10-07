#!/usr/bin/env bash
#
# Tells the cockpit when a Claude it launched is waiting on Tom, and lets the
# cockpit answer a permission prompt or a question on his behalf.
#
# One file per cockpit terminal in ~/.claude/mucka-pending/<terminal>.json
# describes what that terminal's Claude is waiting on. The cockpit's
# PendingWatcher reads it and shows a card with the answers as buttons.
#
#   permission  PermissionRequest hook. Records the request, then waits for
#               the cockpit to drop <terminal>.answer.json and returns that
#               decision to Claude. Claude's multiple-choice questions
#               (AskUserQuestion) come through here too, and the cockpit
#               answers them with `updatedInput.answers`.
#   clear       PostToolUse / Stop / UserPromptSubmit. The wait is over.
#               On UserPromptSubmit in a job's terminal it also records
#               Tom's message in ~/.claude/mucka-jobs/<job>.json, so the
#               job's card can be titled from his first one.
#
# Measured on Claude Code 2.1.292: while this hook waits, the terminal keeps
# showing the dialog or the question and still takes a keypress, so
# whichever of Tom's two routes answers first wins, and nothing is ever
# typed into a live terminal on his behalf. Don't move questions to a
# PreToolUse hook: the question isn't drawn until PreToolUse returns, so a
# wait there would hide it from the terminal.
#
# Sessions the cockpit didn't start have no $MUCKA_TERMINAL and fall straight
# through, so wiring this globally changes nothing for them.
#
# Usage:  … | mucka-pending.sh permission|clear

set -uo pipefail

[ -n "${MUCKA_TERMINAL:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

mode="${1:-}"
dir="$HOME/.claude/mucka-pending"
slug=$(printf '%s' "$MUCKA_TERMINAL" | sed 's|[^A-Za-z0-9_-]|_|g')
pending="$dir/${slug}.json"
answer="$dir/${slug}.answer.json"

# A PermissionRequest hook's default timeout is 600s. Give up a little
# earlier so we exit on our own terms and clean up, rather than being killed.
wait_limit_s=580

input=$(cat)
[ -n "$input" ] || exit 0
mkdir -p "$dir"

write_pending() {
  local id="$1"
  printf '%s' "$input" | jq -c \
    --arg id "$id" \
    --arg agent "${MUCKA_AGENT:-}" --arg job "${MUCKA_JOB:-}" --arg terminal "$MUCKA_TERMINAL" \
    --argjson since "$(($(date +%s) * 1000))" '
    {
      id: $id,
      kind: (if .tool_name == "AskUserQuestion" then "question" else "permission" end),
      agent: $agent,
      job: $job,
      terminal: $terminal,
      sessionId: (.session_id // null),
      tool: (.tool_name // null),
      input: (.tool_input // null),
      suggestions: (.permission_suggestions // []),
      since: $since
    }' > "${pending}.tmp" && mv -f "${pending}.tmp" "$pending"
}

pending_id() {
  [ -f "$pending" ] && jq -r '.id // empty' "$pending" 2>/dev/null
}

case "$mode" in
  permission)
    id="p-$$-$(date +%s)"
    rm -f "$answer"
    write_pending "$id"
    deadline=$(($(date +%s) + wait_limit_s))
    while [ "$(date +%s)" -lt "$deadline" ]; do
      if [ -f "$answer" ] && [ "$(jq -r '.id // empty' "$answer" 2>/dev/null)" = "$id" ]; then
        decision=$(jq -c '.decision' "$answer")
        rm -f "$answer" "$pending"
        jq -cn --argjson d "$decision" \
          '{hookSpecificOutput: {hookEventName: "PermissionRequest", decision: $d}}'
        exit 0
      fi
      # Answered in the terminal, or the turn moved on: a `clear` removed
      # or replaced our file. Stand down and let Claude's own answer stand.
      [ "$(pending_id)" = "$id" ] || exit 0
      sleep 0.25
    done
    [ "$(pending_id)" = "$id" ] && rm -f "$pending"
    exit 0
    ;;

  clear)
    event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty')
    if [ "$event" = "UserPromptSubmit" ] && [ -n "${MUCKA_JOB:-}" ]; then
      jobs_dir="$HOME/.claude/mucka-jobs"
      job_file="$jobs_dir/$(printf '%s' "$MUCKA_JOB" | sed 's|[^A-Za-z0-9_-]|_|g').json"
      mkdir -p "$jobs_dir"
      prev='{}'
      [ -f "$job_file" ] && prev=$(cat "$job_file" 2>/dev/null || printf '{}')
      printf '%s' "$prev" | jq -e . >/dev/null 2>&1 || prev='{}'
      printf '%s' "$prev" | jq -c --argjson e "$input" --argjson ts "$(($(date +%s) * 1000))" '
        {
          firstPrompt: (.firstPrompt // $e.prompt),
          lastPrompt: $e.prompt,
          ts: $ts
        }' > "${job_file}.tmp" && mv -f "${job_file}.tmp" "$job_file"
    fi
    [ -f "$pending" ] || exit 0
    if [ "$event" = "PostToolUse" ]; then
      # Claude can run tools in parallel. Only the call we're waiting on
      # finishing means the wait is over; any other tool finishing doesn't.
      # A question's input gains the answers on the way through, so match
      # it on the tool alone.
      same=$(jq -n --slurpfile p "$pending" --argjson e "$input" \
        '$p[0].tool == $e.tool_name and ($p[0].kind == "question" or $p[0].input == $e.tool_input)')
      [ "$same" = "true" ] || exit 0
    fi
    rm -f "$pending" "$answer"
    exit 0
    ;;
esac

exit 0
