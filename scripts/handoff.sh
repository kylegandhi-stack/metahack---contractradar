#!/usr/bin/env bash
# Open a handoff issue to the other builder.
# Usage: scripts/handoff.sh <builder-1|builder-2> "<title>" "<body>" [extra-label]
# Example: scripts/handoff.sh builder-2 "POST /api/research live on feat/backend" "PR #4 ready. Response matches lib/types.ts." contract-change
set -euo pipefail
REPO="${CR_REPO:-kylegandhi-stack/metahack---contractradar}"
TO="$1"; TITLE="$2"; BODY="$3"; EXTRA="${4:-}"
FROM="$(git config --get contractradar.builder || echo unknown)"
case "$FROM-$TO" in builder-1-builder-2) TAG="[B1→B2]";; builder-2-builder-1) TAG="[B2→B1]";; *) TAG="[$FROM→$TO]";; esac
LABELS="handoff,to:$TO"; [ -n "$EXTRA" ] && LABELS="$LABELS,$EXTRA"
gh issue create -R "$REPO" --title "$TAG $TITLE" --label "$LABELS" \
  --body "$(printf '%s\n\n---\nFrom: %s-agent. Reply in a comment; close the issue when done.\n' "$BODY" "$FROM")"
