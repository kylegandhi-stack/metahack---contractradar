#!/usr/bin/env bash
# ContractRadar agent inbox: shows what the other builder (human or agent) sent you on GitHub.
# Usage: scripts/inbox.sh [builder-1|builder-2] [--peek]
# Role defaults to `git config contractradar.builder`. --peek does not advance the "last checked" marker.
# Never fails hard: it is also run by the Claude Code SessionStart hook.
set -uo pipefail

REPO="${CR_REPO:-kylegandhi-stack/metahack---contractradar}"
ME=""; PEEK=0
for a in "$@"; do
  case "$a" in
    --peek) PEEK=1 ;;
    builder-1|builder-2) ME="$a" ;;
  esac
done
[ -z "$ME" ] && ME="$(git config --get contractradar.builder 2>/dev/null || true)"
if [ -z "$ME" ]; then
  echo "[inbox] Role not set. Run: git config contractradar.builder builder-1   (or builder-2)"
  exit 0
fi
OTHER=builder-2; [ "$ME" = "builder-2" ] && OTHER=builder-1

if ! command -v gh >/dev/null 2>&1; then
  echo "[inbox] gh CLI missing. Install: brew install gh && gh auth login"; exit 0
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "[inbox] gh not logged in. Run: gh auth login"; exit 0
fi

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo .)"
STAMP="$GIT_DIR/contractradar-inbox-last"
SINCE="$(cat "$STAMP" 2>/dev/null || echo 1970-01-01T00:00:00Z)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MY_LOGIN="$(gh api user --jq .login 2>/dev/null || echo '')"

echo "=== ContractRadar inbox for $ME ($REPO) | now $NOW | new since $SINCE ==="

echo
echo "--- Open issues addressed to $ME (label to:$ME) ---"
gh issue list -R "$REPO" --state open --label "to:$ME" --limit 30 \
  --json number,title,updatedAt,labels \
  --jq '.[] | "#\(.number) \(.title)  [\(.labels|map(.name)|join(","))]  updated \(.updatedAt)"' 2>/dev/null \
  || echo "(could not list issues)"

echo
echo "--- Open PRs ---"
gh pr list -R "$REPO" --state open --limit 30 \
  --json number,title,headRefName,author,reviewDecision,labels,isDraft \
  --jq '.[] | "#\(.number) \(.title)  branch=\(.headRefName) by=\(.author.login) review=\(.reviewDecision // "NONE") draft=\(.isDraft) [\(.labels|map(.name)|join(","))]"' 2>/dev/null \
  || echo "(could not list PRs)"

echo
echo "--- New issue/PR comments since last check (excluding your own account) ---"
gh api "repos/$REPO/issues/comments?since=$SINCE&per_page=50&sort=created&direction=asc" \
  --jq ".[] | select(.user.login != \"$MY_LOGIN\") | \"#\(.issue_url|split(\"/\")|last) \(.user.login) @ \(.created_at):\n  \(.body|gsub(\"\n\";\"\n  \")|.[0:600])\"" 2>/dev/null \
  || echo "(could not read comments)"

echo
echo "--- New PR review comments since last check ---"
gh api "repos/$REPO/pulls/comments?since=$SINCE&per_page=50" \
  --jq ".[] | select(.user.login != \"$MY_LOGIN\") | \"PR \(.pull_request_url|split(\"/\")|last) \(.path):\(.line // \"?\") \(.user.login): \(.body|.[0:400])\"" 2>/dev/null \
  || echo "(could not read review comments)"

echo
echo "--- Commits on origin/main you do not have ---"
if git fetch -q origin main 2>/dev/null; then
  git log --oneline HEAD..origin/main 2>/dev/null | head -20
else
  echo "(origin/main not available yet)"
fi

[ "$PEEK" = 0 ] && echo "$NOW" > "$STAMP"
echo
echo "=== end inbox. Act on items per docs/team-protocol.md ==="
exit 0
