# ContractRadar team protocol (for humans AND coding agents)

Source of truth for scope and schedule: the ContractRadar 36-Hour Builder Runbook, copied in `docs/runbook.md`. Deadline: submit by **Wed Nov 4, 3:00 PM PT** (official 6 PM PT). Feature freeze Wed 1 PM PT.

## Roles and file ownership

| Builder 1: backend / agents (branch `feat/backend`) | Builder 2: frontend / product / deploy (branch `feat/frontend`) |
|---|---|
| `app/api/**`, `lib/meta.ts`, `lib/agents/**`, `lib/data/**`, `lib/scoring.ts`, `lib/review.ts`, `lib/schemas.ts`, `data/**`, `scripts/fetch-*`, backend tests, `.env.example` | `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/**`, frontend state, `docs/demo.md`, Vercel, demo video, submission |

Shared, both humans approve (PR label `contract-change`): `lib/types.ts`, `docs/interface.md`, `docs/team-protocol.md`, `AGENTS.md`, `package.json` dependency additions.

Never edit a file the other builder owns. If you need a change there, open a handoff issue.

## Hard rules for agents

1. Work only on your branch. Never push to `main`, never force-push, never merge a PR. Humans merge.
2. Small, buildable commits. Run `npm run lint && npm run build` before every push (once the scaffold exists).
3. Never commit `.env.local` or print `MODEL_API_KEY` / `SAM_API_KEY`.
4. Never invent procurement facts, records, URLs, dates, amounts, or excerpts. Synthetic test records must be titled `[SAMPLE]` or `[TEST]` and never shown in the demo as real.
5. Model for all runtime agents: `muse-spark-1.3` through the OpenAI SDK with `baseURL https://api.meta.ai/v1`. No other model or agent framework.

## How the two agents talk: GitHub only

The agents never talk directly. Everything goes through GitHub on `kylegandhi-stack/metahack---contractradar`, using the `gh` CLI.

**Your role** is stored locally: `git config contractradar.builder builder-1` (or `builder-2`).

**Check your inbox** with `bash scripts/inbox.sh`. It lists open issues labeled `to:<you>`, open PRs, new comments from the other person since your last check, and new commits on `main`. Run it:
- at the start of every session (Claude Code does this automatically via `.claude/settings.json`),
- before starting each new task,
- right after every push,
- and on a timer: in Claude Code run `/loop 20m bash scripts/inbox.sh, then act on anything addressed to me per docs/team-protocol.md`.

**Send a handoff** with `bash scripts/handoff.sh <builder-1|builder-2> "<title>" "<body>" [label]`. This opens an issue titled `[B1→B2] ...` labeled `handoff,to:<them>`. Use it when:
- you need something from a file they own,
- you finished something they consume (e.g. "API route ready on PR #N"),
- you want a contract change (add label `contract-change`).

**Answer a handoff**: comment on the issue (start the comment with `[builder-N-agent]`), do the work, link the PR, and close the issue when done. Answer anything labeled `blocker` before your own next task.

**Status / checkpoints**: one pinned issue, `P0 launch checklist`. At each runbook checkpoint, comment there in this format:

```
[builder-1-agent] CHECKPOINT Mon 9 PM: DONE | AT RISK | MISSED
- done: ...
- next: ...
- needs from builder-2: ... (or none)
```

**PRs**: open as `feat/backend -> main` or `feat/frontend -> main`, fill in the template, request review from the other human. Contract PRs get `contract-change`. After pushing, comment on the PR what the other side must do next.

**Escalate to your human** (stop and ask, do not decide alone) when: a contract change is needed, the other builder has not answered a `blocker` for 45 min, a runbook gate fails (SAM GO/NO-GO Tue 10:30 AM, pipeline Tue 3 PM, deploy Tue 6 PM), or anything needs a secret.

## Checkpoints (PT)

- Mon 9 PM: shared types locked, both agents productive
- Mon 12:15 AM: real data in a browser
- Tue 10:30 AM: SAM GO / NO-GO decided
- Tue 3 PM: Devil's Advocate catches a seeded flaw
- Tue 6 PM: deployed end-to-end app works
- Wed 11 AM: demo recording exists, source links verified
- Wed 1 PM: feature freeze
- Wed 3 PM: submitted and verified
