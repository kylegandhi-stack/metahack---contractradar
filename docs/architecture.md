# Rauros Systems: architecture

Rauros Systems helps a small defense supplier decide which federal opportunities are worth its time. A company profile goes in, and ranked federal records come out, each with evidence, an adversarial review and a status of `APPROVED`, `REVIEW_REQUIRED` or `HOLD`. The repo and internal comments still use the working name ContractRadar.

**Status, 2026-11-03:** this describes `main`. Everything here is merged. SAM.gov search and descriptions have run live locally. Production hasn't been timed with live SAM.gov yet.

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
       Code: SAM descriptions (when turned on), source identity checks, buyer history for the top 5
  -> 5. Devil's Advocate      one independent review per shortlisted record, plus up to 2 open notices
       Strategist revises once, only if a verified BLOCKER appears and time remains
       Code: deterministic gates, fit score, warning cap, final status
  -> Ranked results, up to 10
```

The model writes findings and scores. **Code decides the final status.** That split is the core design choice: a persuasive model output can't approve a record that fails a gate.

## How Meta's models are used

Every agent call uses `muse-spark-1.3` through the OpenAI SDK, with base URL `https://api.meta.ai/v1` (`lib/meta.ts`). The key stays on the server. There's no other agent framework.

**Voice input ("Hey Rauros"), optional:** the browser records up to 20 s of push-to-talk audio, resamples it to 16 kHz mono 16-bit WAV, and posts it to `POST /api/voice-profile`. The server sends it to **Muse Voice Transcribe 1.0** (`muse-voice-transcribe-1.0`, `POST https://api.meta.ai/v1/asr/transcribe`, `PUSH_TO_TALK` mode, keyword-biased toward procurement terms). One `muse-spark-1.3` JSON call then turns the transcript into `CompanyProfile` fields, using only what the speaker said (`lib/voice.ts`). The user reviews the filled form before running research. No audio or transcript is stored or logged.

With the opt-in **wake word** toggle, the mic stays open, but a local voice-activity detector in the browser keeps audio on the device until someone speaks. Each spoken phrase goes to Muse Voice in `wake` mode, and only phrases starting with "Hey Rauros" go on to Muse Spark. A Siri-style orb opens on wake and follows the mic level. Listening stops when the tab is hidden.

| Agent | What the model does | Calls per run | Reasoning effort | Max output tokens |
|---|---|---|---|---|
| Research Planner | Keeps the company's product phrases word for word, and adds search variations and 1-3 candidate codes | 1 | minimal | 3,000 |
| Opportunity Scout | Chooses and calls real search tools, using tool calling | up to 3 rounds | minimal | 3,000 |
| Qualification Analyst | Scores technical fit against a rubric, plus eligibility, execution and timing, citing evidence | 3 (batches of 4 records, in parallel) | low | 6,000 |
| Pursuit Strategist | Picks the shortlist from the top 8 by score, with next steps; can revise once | 1-2 | minimal | 5,000 |
| Devil's Advocate | Reviews each shortlisted record, plus up to 2 more open notices in the top results, independently, returning a verdict and findings | up to 7, in parallel | low | 4,000 |

The Planner, Analyst, Strategist and Devil's Advocate return JSON checked against a schema. Invalid output gets exactly one retry, then fails instead of passing unvalidated data on. Measured runs use about 35,000-45,000 tokens in total, which is about $0.11 for one 44,000-token run at third-party listed rates that aren't confirmed against Meta's rate sheet.

Record text is passed to the model as data, and each prompt says not to treat it as instructions.

### What code does, not the model

- **Retrieval:** source calls and normalization. Facts on a record come from the source response, never from a model.
- **Status:** any verified BLOCKER gives `HOLD`, otherwise any WARNING gives `REVIEW_REQUIRED`, otherwise `APPROVED` (`lib/review.ts`).
- **Gates:** passed deadlines, set-aside conflicts, record identity and low technical match.
- **Evidence check:** a model BLOCKER only stands if it cites the right record and text that is really in that record. Otherwise it becomes a WARNING.
- **Warning limit:** the critic's warnings beyond 2 per result become notes, so nothing is hidden. Warnings from code are never demoted, so three on one result can still exceed the limit.
- **Fit score:** code computes `category` from the product term, target agency and recency, and `execution` from award size when the record has an amount and the profile states a company size. The Analyst supplies `technical` against a rubric and must cite an excerpt: code caps the score if the citation isn't in the record or the record names no search term. Weak technical matches can't be lifted by the other signals. A past award is scored out of the 70 points it can earn, never rescaled. It's relevance, not a chance of winning. The award-size bands are an estimate.
- **Ranking:** the Strategist chooses from the top 8 by score. Reviewed results come first by score, with `HOLD` results below them, then unreviewed results. Ties break by technical fit, category, newest date, then id.

## Limits on each run

| Limit | Value |
|---|---|
| Scout tool rounds | 3 |
| Candidate records | 30 |
| Records analyzed | 12 |
| Critic reviews | 7 (5 shortlisted, up to 2 open notices) |
| Strategist revisions | 1 |
| SAM.gov searches | 2 |
| SAM.gov descriptions | off by default; up to 5 with `SAM_DESCRIPTIONS=on` |
| Tokens | 150,000 |
| Estimated cost | $0.50 |
| Run time | 105 s in code, 120 s function limit |

**Timing:** a full local run with live SAM.gov takes about 62 s: 62.0 s with descriptions off and 63.0 s with 2 descriptions. One earlier run took 75.3 s. The target is under 90 s.

## Accuracy features

- **Repeat postings:** a presolicitation and solicitation of one buy become one result. Different solicitation numbers never merge.
- **SAM descriptions:** off by default because of the SAM.gov quota, and turned on with `SAM_DESCRIPTIONS=on`. When on, or when saved text exists, the critic reads the real notice text for shortlisted notices. The Analyst doesn't, so fit scores can miss requirements found only in that text.
- **Code search:** each Planner code gets its own USAspending search, with a small keyword backup. SAM.gov uses one title search and one PSC search. There's no NAICS filter on SAM.gov, because that would have dropped the top real result in testing.
- **Identity checks:** shortlisted awards are compared with USAspending's award record by id, title and agency. By default, SAM.gov notices only check that their official link contains the id.
- **Buyer history:** past awards where buyer, PSC and title words all agree. These are similar past buys, not proof of an incumbent.
- **SAM snapshot:** saved real notices for demo profiles, used only on a 429 or a missing key, and labeled as cached.

## Measured accuracy

All of these are small samples.

- **Hand-labeled live run:** 5 of 5 top results were relevant by scope on one labeled live run, with ranks 1-5 labeled by one team member (`data/eval/labeling-sheet-after.csv`). That measures relevance, not winnability: 3 were past awards shown as market signals, and 1 was an expired notice the system correctly put on HOLD.

From `npm run eval`, using 20 AquaVector records labeled by a person:

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
- **Limited review:** only the shortlist and up to 2 more open notices get a critic review. Other results stay `REVIEW_REQUIRED` for that reason. The extra reviews don't get SAM.gov descriptions or buyer history, so the critic sees less for those notices.
- **Partial notice text:** with descriptions off and no saved text, the critic sees only a notice's title and summary fields, and each such notice carries a NOTE saying so. Otherwise it reads at most 8,000 characters and no attachments, so requirements elsewhere can be missed.

### What the output means
- **Not advice:** this is decision support, not a bid decision or legal, compliance or eligibility advice. People must check every requirement at the source.
- **Eligibility:** a missing certification is treated as unknown, not as disqualifying. The profile is self-reported.
- **Award amounts** are past obligations, not available budget. **Fit scores** aren't win probabilities.
- **`APPROVED`** means no known issue was found. It doesn't mean approved to bid. A historical award is never open for bidding.
- **Fictional demo profiles only.** Don't enter controlled, classified or sensitive company information. Eval files may include disguised profiles based on real suppliers' public award history, and those never appear in the demo.

### Operations
- **Single function:** a run is one long request with no streaming, so a dropped connection loses it.
- **Cost:** per-stage usage is logged, with limits of 150,000 tokens and $0.50 estimated per run. Measured runs cost about $0.09-$0.11 at third-party listed rates that aren't confirmed against Meta's rate sheet.
- **Cached path:** a Playwright run with federal sources blocked confirmed the USAspending cached banner and labels in the browser. The SAM.gov banner was only tested with a mocked response, because the snapshot is empty until a capture runs after the quota resets.
- **Live SAM.gov behaviour:** search by product code and `noticedesc` both worked in live local runs, and the description text arrives in the `description` field the code reads.

## Data sources and acknowledgments

| Source | Used for | Access |
|---|---|---|
| [USAspending.gov](https://www.usaspending.gov), U.S. Department of the Treasury | Historical contract awards | [Public API](https://api.usaspending.gov), no key |
| [SAM.gov](https://sam.gov), U.S. General Services Administration | Current notices and descriptions | [Get Opportunities Public API](https://open.gsa.gov/api/get-opportunities-public-api/), key required |

- Results link back to their official source records, which remain authoritative.
- This project isn't affiliated with or endorsed by either agency, the U.S. Navy, or the Department of Defense.
- Hero imagery is public-domain U.S. Navy photography, credited in the UI. See `components/HeroBackdrop.tsx`.
- Language model: Muse Spark 1.3 from Meta.
- Speech-to-text: Muse Voice Transcribe 1.0 from Meta (voice input only).

## Where things live

| Path | What's there |
|---|---|
| `app/api/research/route.ts` | The API route and error mapping |
| `lib/agents/` | The orchestrator and five agents |
| `lib/meta.ts` | Model client, run budget, JSON validation |
| `lib/review.ts`, `lib/scoring.ts` | Gates, status and fit score |
| `lib/data/` | Source adapters, cache, snapshot, identity checks and buyer history |
| `lib/types.ts`, `docs/interface.md` | The shared API contract |
| `data/` | Saved real records and eval labels |
| `tests/` | `npm test`, plus `npm run test:live`, which uses real model calls |
