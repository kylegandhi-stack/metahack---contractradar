# Rauros Systems: architecture

Rauros Systems helps a small defense supplier decide which federal opportunities are worth its time. A company profile goes in, and ranked federal records come out, each with evidence, an adversarial review and a status of `APPROVED`, `REVIEW_REQUIRED` or `HOLD`. The repo and internal comments still use the working name ContractRadar.

**Status, 2026-11-02:** this describes the system once PRs #19-#27 and the cost PR are merged. Those PRs were open when this was written. Features they add are marked **(open PR)**.

## How a request flows

All of this runs in one server function, `POST /api/research` in `app/api/research/route.ts`, orchestrated by `lib/agents/orchestrator.ts`.

```
Company profile
  -> 1. Research Planner      search terms and candidate NAICS/PSC codes
  -> 2. Opportunity Scout     model-directed searches of USAspending and SAM.gov
       Code: dedupe, collapse repeat postings, cap at 30, confirm awards at the source
       Code: pick up to 12 records for analysis
  -> 3. Qualification Analyst scores each record against the profile
  -> 4. Pursuit Strategist    picks the top 5, with next steps
       Code: SAM descriptions, source identity checks, buyer history for the top 5
  -> 5. Devil's Advocate      one independent review per shortlisted record
       Strategist revises once, only if a verified BLOCKER appears and time remains
       Code: deterministic gates, fit score, warning cap, final status
  -> Ranked results, up to 10
```

The model writes findings and scores. **Code decides the final status.** That split is the core design choice: a persuasive model output can't approve a record that fails a gate.

## How Muse Spark 1.3 is used

Every model call uses `muse-spark-1.3` through the OpenAI SDK, with base URL `https://api.meta.ai/v1` (`lib/meta.ts`). The key stays on the server. There's no other model or agent framework.

| Agent | What the model does | Calls per run | Reasoning effort | Max output tokens |
|---|---|---|---|---|
| Research Planner | Extracts capabilities, search terms and 1-3 candidate codes from the profile | 1 | minimal | 3,000 |
| Opportunity Scout | Chooses and calls real search tools, using tool calling | up to 3 rounds | minimal | 3,000 |
| Qualification Analyst | Scores technical, category, eligibility, execution and timing fit, citing evidence | 3 (batches of 4 records, in parallel) | low | 6,000 |
| Pursuit Strategist | Picks the shortlist and next steps; can revise once | 1-2 | minimal | 5,000 |
| Devil's Advocate | Reviews each shortlisted record independently, returning a verdict and findings | up to 5, in parallel | low | 4,000 |

The Planner, Analyst, Strategist and Devil's Advocate return JSON checked against a schema. Invalid output gets exactly one retry, then fails instead of passing unvalidated data on. Measured runs use about 35,000-45,000 tokens in total, which is about $0.11 for one 44,000-token run at third-party listed rates that aren't confirmed against Meta's rate sheet.

Record text is passed to the model as data, and each prompt says not to treat it as instructions.

### What code does, not the model

- **Retrieval:** source calls and normalization. Facts on a record come from the source response, never from a model.
- **Status:** any verified BLOCKER gives `HOLD`, otherwise any WARNING gives `REVIEW_REQUIRED`, otherwise `APPROVED` (`lib/review.ts`).
- **Gates:** passed deadlines, set-aside conflicts, record identity and low technical match.
- **Evidence check:** a model BLOCKER only stands if it cites the right record and text that is really in that record. Otherwise it becomes a WARNING.
- **Warning limit:** the critic's warnings beyond 2 per result become notes, so nothing is hidden. Warnings from code are never demoted, so three on one result can still exceed the limit.
- **Fit score:** computed from the Analyst's components, with a confidence ceiling set by status (`lib/scoring.ts`). It's relevance, not a chance of winning.
- **Ranking:** by fit score, with `HOLD` results below the rest.

## Limits on each run

| Limit | Value |
|---|---|
| Scout tool rounds | 3 |
| Candidate records | 30 |
| Records analyzed | 12 |
| Critic reviews | 5 |
| Strategist revisions | 1 |
| SAM.gov searches | 2 |
| SAM.gov descriptions **(open PR)** | up to 5 |
| Tokens | 150,000 |
| Estimated cost **(open PR)** | $0.50 |
| Run time | 105 s in code, 120 s function limit |

**Timing:** production took 52-82 s before the open PRs. Local runs of those PRs took 40-53 s with SAM.gov blocked. **A full run with live SAM.gov and descriptions has not been measured yet.** The target is under 90 s.

## Accuracy features (open PRs)

- **Repeat postings:** a presolicitation and solicitation of one buy become one result. Different solicitation numbers never merge.
- **SAM descriptions:** the critic reads the real notice text for shortlisted notices. The Analyst doesn't, so fit scores can miss requirements found only in that text.
- **Code search:** each Planner code gets its own USAspending search, with a small keyword backup. SAM.gov uses one title search and one PSC search. There's no NAICS filter on SAM.gov, because that would have dropped the top real result in testing.
- **Identity checks:** shortlisted awards are compared with USAspending's award record by id, title and agency. By default, SAM.gov notices only check that their official link contains the id.
- **Buyer history:** past awards where buyer, PSC and title words all agree. These are similar past buys, not proof of an incumbent.
- **SAM snapshot:** saved real notices for demo profiles, used only on a 429 or a missing key, and labeled as cached.

## Measured accuracy

From `npm run eval`, using 20 AquaVector records labeled by a person, with small samples:

- **Ranking, on fixed saved records:** precision@5 of 80% (4 of 5) in both of 2 runs, and recall@10 of 50%.
- **Live retrieval: no usable number yet.** Most live results aren't among the 20 labeled records, and results vary between runs.
- **Seeded flaws:** the Devil's Advocate caught 4 of 4 synthetic flaws in `npm run test:live`.

Please don't present these as general accuracy.

## Risks and limitations

### Data
- **SAM.gov quota:** third-party docs list about 10 calls a day for a key without a role and about 1,000 with one, unconfirmed by GSA. A local key hit its limit after one evening of testing. A spent quota means no live notices until 00:00 UTC.
- **Stale cached data:** saved records may be out of date. Cached runs say so and show when records were retrieved.
- **Search recall:** results depend on search terms and on USAspending's sort by amount. Scout's term choices change between runs, so good records can be missed, and no list is complete.
- **SAM.gov checks:** the default identity check for notices is weak. A full lookup costs quota, so it's off unless `SAM_IDENTITY_LOOKUPS=on`.

### Model
- **Non-determinism:** the same profile can produce different shortlists and findings between runs.
- **Limited review:** only the top 5 get a critic review. Other results stay `REVIEW_REQUIRED` for that reason.
- **Partial notice text:** the critic reads at most 8,000 characters of a description and doesn't read attachments, so requirements elsewhere can be missed.

### What the output means
- **Not advice:** this is decision support, not a bid decision or legal, compliance or eligibility advice. People must check every requirement at the source.
- **Eligibility:** a missing certification is treated as unknown, not as disqualifying. The profile is self-reported.
- **Award amounts** are past obligations, not available budget. **Fit scores** aren't win probabilities.
- **`APPROVED`** means no known issue was found. It doesn't mean approved to bid. A historical award is never open for bidding.
- **Fictional demo profiles only.** Don't enter controlled, classified or sensitive company information. Eval files may include disguised profiles based on real suppliers' public award history, and those never appear in the demo.

### Operations
- **Single function:** a run is one long request with no streaming, so a dropped connection loses it.
- **Cost:** tokens are capped per run. Per-stage logging and a $0.50 estimated cost cap are in an **(open PR)**. Costs are estimates until compared with Meta billing.
- **Cached path:** the fallback logic has unit tests, but the end-to-end cached banner hasn't been tested in a browser.

## Data sources and acknowledgments

| Source | Used for | Access |
|---|---|---|
| [USAspending.gov](https://www.usaspending.gov), U.S. Department of the Treasury | Historical contract awards | [Public API](https://api.usaspending.gov), no key |
| [SAM.gov](https://sam.gov), U.S. General Services Administration | Current notices and descriptions | [Get Opportunities Public API](https://open.gsa.gov/api/get-opportunities-public-api/), key required |

- Results link back to their official source records, which remain authoritative.
- This project isn't affiliated with or endorsed by either agency, the U.S. Navy, or the Department of Defense.
- Hero imagery is public-domain U.S. Navy photography, credited in the UI. See `components/HeroBackdrop.tsx`.
- Language model: Muse Spark 1.3 from Meta.

## Where things live

| Path | What's there |
|---|---|
| `app/api/research/route.ts` | The API route and error mapping |
| `lib/agents/` | The orchestrator and five agents |
| `lib/meta.ts` | Model client, run budget, JSON validation |
| `lib/review.ts`, `lib/scoring.ts` | Gates, status and fit score |
| `lib/data/` | Source adapters, cache, and **(open PR)** snapshot, identity checks and buyer history |
| `lib/types.ts`, `docs/interface.md` | The shared API contract |
| `data/` | Saved real records and **(open PR)** eval labels |
| `tests/` | `npm test`, plus `npm run test:live`, which uses real model calls |
