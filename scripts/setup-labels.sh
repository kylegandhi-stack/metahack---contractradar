#!/usr/bin/env bash
# One-time: create the coordination labels. Safe to re-run.
set -uo pipefail
REPO="${CR_REPO:-kylegandhi-stack/metahack---contractradar}"
mk() { gh label create "$1" -R "$REPO" --color "$2" --description "$3" --force >/dev/null && echo "label: $1"; }
mk "to:builder-1"    "1d76db" "Needs action from Builder 1 (backend)"
mk "to:builder-2"    "5319e7" "Needs action from Builder 2 (frontend)"
mk "handoff"         "0e8a16" "Work handed from one builder to the other"
mk "contract-change" "d93f0b" "Touches lib/types.ts or docs/interface.md: both humans must approve"
mk "blocker"         "b60205" "Blocks the other builder; answer first"
mk "checkpoint"      "fbca04" "Runbook checkpoint status"
