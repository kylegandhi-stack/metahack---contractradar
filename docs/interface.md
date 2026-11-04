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
| 429 | `RATE_LIMITED` | Meta API rate limit, per-run budget exhausted, or this API's per-IP or daily run limit. The last two include a `Retry-After` header |
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
- `fitScore` is relevance points, not a win probability. `fitBreakdown` components are `null` when unknown.
  - `fitMax` is optional and gives the points this record could earn, and `fitScore` is out of it. A historical award can't earn eligibility or timing, so it's out of 70, or 63 if the profile names no target agencies. A notice is out of 100, or 93. **Show the score as `fitScore / fitMax` when present, and never rescale it to 100.** Treat a missing `fitMax` as 100.
  - `fitBreakdown.category` (0-20) is computed by code from the product term, target agency and recency. `execution` is computed from award size when the record has an amount and the profile states a company size, and otherwise comes from the model. `technical`, `eligibility` and notice `timing` come from the model, with code capping `technical` when it has no verbatim excerpt or the record names no search term.
  - `fitSignals` is optional and lists the deterministic inputs, each with `points`, `max` and a `detail` to show. Award-size details are estimates.
  - If `technical` is under 20, `category` and `execution` are each limited to a quarter of it, so a buyer, date or size match can't lift a weak match. `fitSignals` still shows the points before that limit.
  - The Strategist chooses from the top 8 by score. Reviewed results are listed first, followed by unreviewed results, so a score can be higher below them. Reviewed means the shortlist plus up to 2 open notices outside it: the highest-scoring ones with no passed deadline that make the final 10. Early-stage notices and past awards outside the shortlist aren't reviewed.
  - Equal scores are ordered by technical fit, category, newest date, then id, so the order is stable.
- `reviewStatus` is set by deterministic code after the Devil's Advocate runs:
  - any verified `BLOCKER` gives `HOLD` (UI: "Hold / Do not pursue as presented")
  - else any `WARNING` gives `REVIEW_REQUIRED`
  - else `APPROVED`
- `findings` is never hidden: every BLOCKER and WARNING must be visible on the card and in the drawer.
- `agentEvents` is the real log of the five stages in order: planner, scout, analyst, strategist, devils_advocate. P0 returns it after completion (no streaming).
- `dataMode: "cached"` means at least one shown record comes from saved public data, and the UI must show a non-dismissable banner: `Cached public records - retrieved <date>`.
  - `cachedSources` lists which sources are saved in this run. Other sources were not served from saved data, which doesn't mean they ran: a source with no key returns nothing. Only call a source live if the results include its records. If it's absent, treat every source as saved.
  - The banner must name what is saved, for example `Cached SAM.gov notices - retrieved <date>`, and must not say live sources were not queried: they were queried and failed, or are not configured.
  - `<date>` is the oldest `retrievedAt` among records from `cachedSources`.

## Run budget (server enforced)

Max 3 Scout tool turns, 30 candidate records, 12 deep analyses, 7 critic reviews (5 shortlisted, up to 2 open notices), 1 strategist revision. Model for every stage: `muse-spark-1.3`.

## `POST /api/voice-profile[?mode=command|wake]` (optional voice input)

Body: a WAV recording, `Content-Type: audio/wav`. RIFF/WAVE, mono, 16-bit PCM, 16 or 24 kHz, between 0.5 and 25 seconds, at most 1.5 MB. The browser records up to 20 s.

Pipeline: `muse-voice-transcribe-1.0` (`POST /v1/asr/transcribe`, `PUSH_TO_TALK`) produces the transcript, then one `muse-spark-1.3` JSON call produces profile fields. Uses no SAM.gov or USAspending calls.

Modes:
- `command` (default): the whole phrase is a company description. A leading "Hey Rauros" is stripped.
- `wake`: sent by the browser's opt-in wake-word listener for each phrase its local voice detector hears. Only Muse Voice runs unless the transcript starts with "Hey Rauros" (fuzzy: "Hey Rarus", "Hi Roros", "Hey rare us"; a bare name only as the first word). Responses: `{ "wake": false }` (nothing else returned, no Muse Spark call), `{ "wake": true, "needsCommand": true }` (the name alone, so the UI opens the orb and records the description in `command` mode), or `{ "wake": true, "transcript", "profile", "models" }` when the description followed in the same breath. Wake checks have their own per-IP window (`VOICE_WAKE_PER_IP`, default 60 per 10 minutes) and a ceiling per UTC day and server instance (`VOICE_WAKE_DAILY`, default 300).
  - **Off by default.** `mode=wake` returns 404 `BAD_REQUEST` ("The wake word is turned off on this deployment.") before reading the body, unless the server has `VOICE_WAKE=on`. The UI shows the wake-word toggle only when built with `NEXT_PUBLIC_VOICE_WAKE=on`. Not enabled in production before the hackathon freeze (#53): Muse Voice spend isn't in `RunBudget`, and an open mic sends nearby speech to Meta.

Success: `200`

```json
{
  "transcript": "AquaVector Systems. We're twelve people making hydrophones and underwater acoustic sensors, and we sell to the Navy.",
  "profile": { "name": "AquaVector Systems", "capabilities": "...", "smallBusiness": true, "targetAgencies": ["Department of the Navy"] },
  "models": { "transcription": "muse-voice-transcribe-1.0", "extraction": "muse-spark-1.3" }
}
```

`profile` is `Partial<CompanyProfile>`: a field is present only if the speaker said it, within `CompanyProfileSchema` bounds. It never contains invented names, certifications or agencies. The UI fills only the present fields and never runs research automatically.

Errors use `ResearchError`: 400 `BAD_REQUEST` (not a supported WAV, too short or too long), 413 `BAD_REQUEST` (too large), 422 `BAD_REQUEST` (no speech recognized), 429 `RATE_LIMITED` (per-IP voice bucket `voice:<ip>`, separate from research runs, with its own daily count, `RATE_LIMIT_VOICE_DAILY`), 502 `UPSTREAM_ERROR`, 504 `TIMEOUT`, 500 `INTERNAL`. Logs hold only durations, field names and token counts: never audio, transcript or the key.
