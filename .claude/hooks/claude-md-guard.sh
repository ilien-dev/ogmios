#!/usr/bin/env bash
#
# Keeps CLAUDE.md a rewritten whole under 1000 tokens.
#
# PreToolUse:  Edit/MultiEdit on CLAUDE.md, or a shell command that appends to
#              or edits it in place, is blocked: a change means re-reading the
#              file and rewriting it with Write, so rules get merged and
#              reordered instead of piling up at the bottom.
# PostToolUse: after a Write, the file must fit the budget; if not, the
#              assistant is told to rewrite it again.
#
# Exit 2 blocks and hands stderr back to the assistant. Anything unexpected
# (no jq, unreadable payload) exits 0: a guard that fails closed traps a session.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat)
event=$(jq -r '.hook_event_name // ""' <<<"$payload")
tool=$(jq -r '.tool_name // ""' <<<"$payload")
path=$(jq -r '.tool_input.file_path // ""' <<<"$payload")
cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
root="${CLAUDE_PROJECT_DIR:-.}"
budget=1000

is_claude_md() { [[ $1 == "$root/CLAUDE.md" || $1 == "CLAUDE.md" ]]; }

rewrite_rules="Rewrite the whole file with Write: re-read it, put each rule in its
section, merge overlaps, delete anything the code already tells you (names,
stack, file listings), and stay at or under $budget tokens (chars/4)."

if [[ $event == "PreToolUse" ]]; then
	if [[ $tool == "Edit" || $tool == "MultiEdit" ]] && is_claude_md "$path"; then
		echo "CLAUDE.md is never patched in place. $rewrite_rules" >&2
		exit 2
	fi
	if [[ $tool == "Bash" ]] && grep -Eq '(>>|sed -i|tee -a|perl -pi)[^|;&]*CLAUDE\.md' <<<"$cmd"; then
		echo "CLAUDE.md is not appended to or edited from the shell. $rewrite_rules" >&2
		exit 2
	fi
	exit 0
fi

if [[ $event == "PostToolUse" && $tool == "Write" ]] && is_claude_md "$path"; then
	chars=$(tr -d '\r' <"$root/CLAUDE.md" | wc -c)
	tokens=$(((chars + 3) / 4))
	if ((tokens > budget)); then
		echo "CLAUDE.md is now ~$tokens tokens, over the $budget budget. $rewrite_rules" >&2
		exit 2
	fi
fi
exit 0
