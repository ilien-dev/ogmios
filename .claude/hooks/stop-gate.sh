#!/usr/bin/env bash
#
# Before the assistant says it is done: CLAUDE.md within budget, oxlint clean,
# prettier clean. Clippy and the test suites stay in `bun run check`; a gate
# that costs minutes on every stop gets switched off.
#
# Bounded: after 3 blocked rounds in one session it lets the stop through and
# says so, so a session can always end.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
command -v bun >/dev/null 2>&1 || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

payload=$(cat)
session=$(jq -r '.session_id // "unknown"' <<<"$payload")
counter="${TMPDIR:-/tmp}/ogmios-stop-gate-$session"
rounds=$(cat "$counter" 2>/dev/null || echo 0)

report=""
if ! out=$(bun test scripts/claude-md.test.ts 2>&1); then
	report+=$'\n== CLAUDE.md budget ==\n'"$(tail -n 15 <<<"$out")"
fi
if [[ -d node_modules ]]; then
	if ! out=$(bunx oxlint --format unix 2>&1); then
		report+=$'\n== oxlint ==\n'"$(head -n 40 <<<"$out")"
	fi
	if ! out=$(bunx prettier --check --log-level warn . 2>&1); then
		report+=$'\n== prettier (fix: bun run format) ==\n'"$(head -n 20 <<<"$out")"
	fi
fi

if [[ -z $report ]]; then
	rm -f "$counter"
	exit 0
fi
if ((rounds >= 3)); then
	rm -f "$counter"
	echo "stop-gate: still failing after 3 rounds; letting the stop through. Say so to the owner." >&2
	exit 0
fi
echo $((rounds + 1)) >"$counter"
echo "Not done yet. Fix these, then stop again:$report" >&2
exit 2
