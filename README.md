# Rauros Systems

**Find the contracts worth bidding. Kill the ones that aren't.**

Rauros Systems is an AI business-development team for small defense suppliers. Describe your company, and five agents search real U.S. federal procurement records, qualify each one against your capabilities, and argue against their own recommendations before you spend a week on a proposal.

Every result links to its official source record and carries a status set by code: `APPROVED`, `REVIEW_REQUIRED` or `HOLD`.

**Live app:** https://metahack-contractradar.vercel.app

*"ContractRadar", the project's working name, still appears in the repo URL, older docs and some internal prompts.*

## The five agents

Each agent runs on **Meta's Muse Spark 1.3** (`muse-spark-1.3`), called through the OpenAI SDK at `https://api.meta.ai/v1`. Optional voice input (**Hey Rauros**) adds a second Meta model: **Muse Voice Transcribe 1.0** (`muse-voice-transcribe-1.0`) turns a spoken company description into text, and Muse Spark 1.3 turns that text into the profile form. No other models or agent frameworks are used at runtime.

| # | Agent | How Muse Spark 1.3 runs it |
|---|---|---|
| 1 | **Research Planner** | Keeps the company's own product phrases word for word, and adds search variations and candidate NAICS and PSC codes, as schema-checked JSON |
| 2 | **Opportunity Scout** | Uses tool calling to choose and run real searches of USAspending and SAM.gov, for up to 3 rounds |
| 3 | **Qualification Analyst** | Scores up to 12 records for technical fit against a rubric, plus eligibility, execution and timing, citing evidence, in parallel batches |
| 4 | **Pursuit Strategist** | Picks the top 5 from the 8 best-scoring records, with next steps, and can revise once if a verified blocker appears |
| 5 | **Devil's Advocate** | Reviews each shortlisted record in a separate, independent call and tries to find what's wrong with the recommendation |

**The model writes findings, but code decides the status.** A persuasive answer can't approve a record that fails a check:

- A passed deadline or a set-aside conflict with the profile is a `BLOCKER`, which means `HOLD`.
- A model's blocker only stands if it cites text that's really in the source record. Otherwise it's downgraded and asks for verification.
- A record that doesn't match its source by id, title and agency is a `BLOCKER`.
- Invalid model output gets one retry, then fails instead of passing on.
- Code computes part of the score from the record: product term, target agency, recency and award size. A past award is scored out of the 70 points it can earn, never rescaled to 100.

More detail is in [docs/architecture.md](docs/architecture.md).

## Data sources

| Source | Used for | Access |
|---|---|---|
| [USAspending.gov](https://www.usaspending.gov) (U.S. Department of the Treasury) | Past contract awards, buyer history | Public API, no key |
| [SAM.gov](https://sam.gov) (U.S. General Services Administration) | Current notices and their descriptions | [Public API](https://open.gsa.gov/api/get-opportunities-public-api/), key required |

Records come straight from these sources, and the official records remain authoritative. This project isn't affiliated with or endorsed by these agencies, the U.S. Navy, the Department of Defense or Meta. Hero imagery is public-domain U.S. Navy photography, credited in the app.

## Run it

You need Node.js and a Meta Model API key. A SAM.gov key is optional: without one, the app shows historical awards only and says so.

```bash
git clone https://github.com/kylegandhi-stack/metahack---contractradar.git
cd metahack---contractradar
npm install
cp .env.example .env.local   # then add MODEL_API_KEY, and SAM_API_KEY if you have one
npm run dev                  # http://localhost:3000
```

Click **Load demo: AquaVector Systems**, then **Run research**. A run takes about a minute. To see the interface with sample data and no keys, open `/?sample=1`.

| Command | What it does | Cost |
|---|---|---|
| `npm test` | Backend test suite | Free, no keys or network |
| `npm run test:live` | Seeds flaws and checks that the real critic catches them | Model tokens |
| `npm run eval` | Scores ranking against labeled records | Model tokens |

| Setting | Effect |
|---|---|
| `SAM_DESCRIPTIONS=on` | Fetches notice text for the shortlist, using up to 5 more SAM.gov calls per run |
| `SAM_IDENTITY_LOOKUPS=on` | Checks shortlisted notices against SAM.gov, using up to 5 more calls per run |

Both are off by default, because SAM.gov keys can have small daily quotas.

## Limitations

- **Decision support only.** This isn't a bid decision or legal, compliance or eligibility advice. Check every requirement at the source.
- **Fit scores aren't win probabilities, and award amounts aren't available budget.** They show relevance and past obligations.
- **`APPROVED` isn't approval to bid.** It means no known issue was found, and a historical award is never open.
- **Fictional company profiles only.** Don't enter classified, controlled or sensitive information.
- **Results vary between runs.** The model chooses different searches, and no search is complete. Only the top 5 get a critic review.
- **Partial notice text.** Descriptions are off by default, so the critic may see only a notice's title and summary fields. Attachments are never read.
- **Live SAM.gov quota.** A spent quota means no live notices until it resets. Demo profiles can fall back to labeled saved notices once a snapshot is captured.
- **Early accuracy numbers.** Hand-labeled precision@5 was 60% for AquaVector Systems (3 of 5) and 80% for a second test profile (4 of 5). Those are 2 production runs from before the accuracy changes (deduping, search by code, source checks), labeled by one team member, so they don't measure the current search. Ranking on 20 other hand-labeled records also scored 80% in 2 runs. See [the labeled sheet](data/eval/labeling-sheet.csv).
- **Not fully tested live:** a full run with live SAM.gov and descriptions hasn't been timed. With SAM.gov off, local runs took 45-48 s.

## Built during the hackathon, Oct 26 to Nov 4

This project was built from scratch during the hackathon. It didn't start from an earlier codebase.

**You can check this yourself:**

- [This repository](https://github.com/kylegandhi-stack/metahack---contractradar) was created on Nov 2, 2026, inside the hackathon window.
- The [full commit history](https://github.com/kylegandhi-stack/metahack---contractradar/commits/main) starts with the first commit that night and is public, as are the [pull requests](https://github.com/kylegandhi-stack/metahack---contractradar/pulls?q=is%3Apr) and [issues](https://github.com/kylegandhi-stack/metahack---contractradar/issues?q=is%3Aissue) showing the work as it happened.

```bash
git log --reverse --format='%ad %s' --date=iso | head   # earliest commits
```

**What isn't original:**

- The app was scaffolded with `create-next-app`, and it uses open-source packages listed in [package.json](package.json), including Next.js, React, Tailwind CSS, the OpenAI SDK and Zod.
- Procurement records come from the public sources above.
- Hero imagery is public-domain U.S. Navy photography.

**How it was built:** by a two-person team, Santiago Cavalieri (backend and agents) and Kyle Gandhi (frontend, product and deployment), with AI coding assistants helping write the code. Commits made with Claude Code say so in their messages. At runtime, the product uses two Meta models: Muse Spark 1.3 for the five agents and for structuring voice input, and Muse Voice Transcribe 1.0 for speech-to-text.
