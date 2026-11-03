# ContractRadar API contract

Owner: Builder 1 writes it, both builders approve it. Types live in `lib/types.ts`. Any change to this file or to `lib/types.ts` goes through a PR labeled `contract-change` that both humans approve.

## `POST /api/research`

Request body (`ResearchRequest`):

```json
{
  "profile": {
    "name": "AquaVector Systems",
    "capabilities": "12-person U.S. maker of hydrophones, underwater acoustic sensors, environmental monitoring instruments, and ruggedized components for autonomous underwater vehicles.",
    "smallBusiness": true,
    "certifications": [],
    "targetAgencies": ["Department of the Navy"]
  }
}
```

Validation (Zod, server side): `name` 1-120 chars, `capabilities` 10-2000 chars, arrays at most 10 items. Invalid input returns 400.

Success: `200` with `ResearchResponse` (see `lib/types.ts`). Example fixture: `data/sample-research-response.json` (synthetic, every title starts with `[SAMPLE]`).

Errors: JSON `ResearchError` = `{ "error": { "code", "message" } }`

| HTTP | code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Profile fails validation |
| 429 | `RATE_LIMITED` | Meta API rate limit or per-run budget exhausted |
| 502 | `UPSTREAM_ERROR` | USAspending / SAM / Meta failed and no cache is usable |
| 504 | `TIMEOUT` | Run exceeded the server time cap (target 60 s) |
| 500 | `INTERNAL` | Anything else |

If live sources fail but saved real records are usable, the route returns 200 with `dataMode: "cached"` and a warning. It never substitutes invented records. There are two saved sets:
- `data/verified-records.json`: USAspending awards, used when USAspending fails.
- `data/sam-snapshot.json`: SAM notices captured for demo profiles, used only when SAM.gov returns a 429 or its key is missing. USAspending stays live.

## Semantics the UI can rely on

- `record.kind`
  - `historical_award`: a past USAspending award. `deadlineAt` is always null. UI shows "Historical award", labels the score "Historical relevance", and shows no apply/bid CTA.
  - `open_notice`: the SAM.gov notice type is a solicitation (ptype `o`/`k`). This describes the notice type, not whether it can still be answered. An expired `open_notice` must carry a BLOCKER and `reviewStatus: "HOLD"`, and the UI must show it as expired.
  - `early_stage_notice`: SAM.gov sources sought / presolicitation (ptype `r`/`p`).
- `record.url` is always an official source URL. `record.excerpts[].text` is verbatim from the source field named in `field`.
- `awardAmount` is the historical obligation, never "available budget".
- Optional fields, which may be absent. The UI must work without them:
  - `record.solicitationNumber`: the SAM solicitation number.
  - `record.relatedNotices`: other SAM postings of the same buy, collapsed into this record, such as a presolicitation behind a solicitation.
  - `record.recipient`: who won a USAspending award.
  - `result.priorAwards`: past USAspending awards from the same buyer, for open and early-stage notices. Each comes from a source record and is never inferred. `amount` is a historical obligation, never "available budget".
- Missing facts are `null`. The UI shows "Unknown" or "Not provided".
- `fitScore` is 0-100 relevance, not a win probability. `fitBreakdown` components are `null` when unknown.
- `reviewStatus` is set by deterministic code after the Devil's Advocate runs:
  - any verified `BLOCKER` gives `HOLD` (UI: "Hold / Do not pursue as presented")
  - else any `WARNING` gives `REVIEW_REQUIRED`
  - else `APPROVED`
- `findings` is never hidden: every BLOCKER and WARNING must be visible on the card and in the drawer.
- `agentEvents` is the real log of the five stages in order: planner, scout, analyst, strategist, devils_advocate. P0 returns it after completion (no streaming).
- `dataMode: "cached"` means at least one shown record comes from saved public data, and the UI must show a non-dismissable banner: `Cached public records - retrieved <date>`.
  - `cachedSources` lists which sources are saved in this run. Other sources were live. If it's absent, treat every source as saved.
  - The banner must name what is saved, for example `Cached SAM.gov notices - retrieved <date>`, and must not say live sources were not queried: they were queried and failed, or are not configured.
  - `<date>` is the oldest `retrievedAt` among records from `cachedSources`.

## Run budget (server enforced)

Max 3 Scout tool turns, 30 candidate records, 12 deep analyses, 5 critic reviews, 1 strategist revision. Model for every stage: `muse-spark-1.3`.
