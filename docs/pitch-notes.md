# Pitch notes: 3-minute demo and judge Q&A

For Builder 2, who records the video.

**Length:** the demo video can be **at most 3 minutes**, confirmed by Santiago from the submission page. This script runs **about 2:45**, so there's a buffer. Count any title card or end screen toward the limit. The runbook's 90-second plan is out of date, and this file replaces it.

## Before you record

**1. Run it first and fill in what the real run returned.** Results change between runs, so don't read the names below from this page. Run the preset, then update the "Expected" notes to match what's on screen.

**2. Choose the HOLD record from that run.** You need an open notice with an **Expired** badge. Last seen in production:

| Record | What the SAM.gov page showed when checked | Inactive date |
|---|---|---|
| **DT-511C and DT-592D Hydrophones and Spare Parts** (preferred) | **Active**, offers due Oct 30, 2026, 2:00 PM EDT; NUWC Division Newport | Nov 14 |
| Hydrophone Mount (backup) | **Active**, offers due Oct 22, 2026, 4:30 PM EDT; DLA Mechanicsburg | Nov 6 |

The preferred record has also been one of the highest fit scores, 74-84 across runs. That's the story: strong match, still marked Active, and the app says stop. Say the score only if it's on screen.

**3. Budget SAM.gov calls.** Assume 10 a day per key, resetting Tue 4 PM PT. One run uses 2 calls. With `SAM_DESCRIPTIONS` off, Kyle's key allows about 5 takes a day, minus any other production runs. Local keys don't help the live site.

**4. If the app shows a cached banner,** keep it on screen and say saved records are being used. Never call cached data live.

**5. Don't speed up or cut silently.** A run takes about a minute. Cutting the wait is fine if the video says so, as the script does.

## The 3-minute script

About 290 spoken words, with room for clicks, plus about 5 s for the optional Strong historical match line. Time a full read before recording. If a take runs long, cut the source-link click first, not the HOLD segment.

| Time | On screen and what to click | What to say |
|---|---|---|
| **0:00-0:18** | Home page, headline visible | "A small defense supplier can lose a week on a proposal it was never going to win. Rauros Systems is an AI business-development team that finds federal opportunities, then argues against them before you spend that week." |
| **0:18-0:35** | Click **Load demo: AquaVector Systems**. Pause on the form | "AquaVector is a fictional 12-person maker of hydrophones and underwater sensors. It's a demo company, but everything you'll see next is a real federal record." |
| **0:35-1:00** | Click **Run research**. Show **Agents running**. Cut, and put "wait shortened" on screen | "Five agents run on Meta's Muse Spark 1.3. A Planner picks search terms. A Scout chooses real searches on USAspending and SAM.gov. An Analyst scores each record, a Strategist picks the top five, and a Devil's Advocate tries to break those picks. We've shortened the wait." |
| **1:00-1:32** | Show the ranked results. Scroll through the top 5, pointing at the **Open notice** and **Historical award** labels and each status | "These are real records, each linked to its source. Open notices are labeled apart from past awards, which you can't bid on. The score is relevance, not a chance of winning. **[Name the top result and when it's due.]** Every status is set by code, not the model. **[Only if a result on screen shows Strong historical match beside REVIEW REQUIRED, point at both and say:]** High fit doesn't mean go. The critic still flags what a human has to verify." |
| **1:32-2:07** | Find the HOLD result with the **Expired** badge. Click it. Hold on **Expired — response deadline passed** | "Here's the one that matters. **[Read the title.]** It looks like a great fit, and SAM.gov still lists it as active. But the response deadline was **[read the date]**. The app puts it on hold, explains why, and notes it may still help identify the buyer. Without this check, that's a week spent on a bid that can't be accepted." |
| **2:07-2:27** | Scroll to **Red team findings**, then **Evidence · verbatim from source**. Click the source link in **Source record** to show the real page | "The critic's findings sit beside the source's own words. If the model claims a contradiction it can't back with text from the record, code downgrades it. And you can always open the official record." |
| **2:27-2:45** | Back to the results, then the **Red team** panel | "It tells you what to pursue, what not to, and why. It makes recommendations, not legal or eligibility decisions. That's Rauros Systems, built during this hackathon, with Muse Spark 1.3 running all five agents." |

**Optional, only if the take is running short and **Buyer history** has entries on the result you open:** "These are past similar awards from this buyer." Don't call anyone the incumbent.

### Don't say
- "Guaranteed", "you will win", or any chance of winning. The fit score isn't one.
- "Available budget" about an award amount. It's a past obligation.
- "Approved to bid". `APPROVED` means no known issue was found.
- "Every open contract" or "complete coverage". No search is complete.
- "The critic checks everything". It reviews the top 5, and other results say so.
- That it reads a notice's full text, unless descriptions were on for that run. They're off by default.
- A run time with live SAM.gov until one has been measured. With SAM.gov off, it's 45-48 s locally.

## Accuracy, with its caveat

**If asked, or if you show it:** "On two hand-labeled production runs from before our accuracy changes, precision at five was 60% for AquaVector and 80% for a second test profile."

- That's 3 of 5 and 4 of 5, labeled by one team member (`data/eval/labeling-sheet.csv`).
- Those runs predate the deduping, search-by-code and source-check work, so **they don't measure the current search**. Please don't describe it as general accuracy.
- An "after" number may follow after Tue 4 PM PT, using `scripts/labeling-sheet-after.mts` (#38). It would be one run with one labeler, so call it directional and use the exact caveat that comes with it.
- The seeded test caught 4 of 4 synthetic flaws. That shows the critic can catch them, not how often it does on real data.

## Judge Q&A

From runbook section 10, updated to match what shipped.

**Why Meta?**
Muse Spark 1.3 drives all five agent stages: tool use, evidence-grounded qualification, structured scoring explanations and an independent adversarial critique. The core product logic, not just the UI, depends on Meta's model.

**Why agentic?**
The Scout chooses and invokes real retrieval tools, qualification is conditioned on evidence, and a separate critic can overturn an earlier recommendation. A deterministic server enforces record-type and safety checks, so a persuasive model output can't approve a record that fails them.

**What's defensible?**
A niche workflow, procurement-specific data normalization, source attribution, checks against misleading bids, and an explainable UI. We aren't claiming a breakthrough foundation model.

**What comes next?**
Wider verified live coverage of solicitations, opportunity alerts, company-specific compliance profiles, teaming-partner discovery and secure document workspaces. None of it was required for the hackathon.

**Likely follow-ups**
- *How accurate is it?* Use the wording and caveat above.
- *Is this new work?* Yes: the repo was created Nov 2 and its full history is public. AI coding assistants helped write it, and the README says so.
- *What if SAM.gov is down or out of quota?* It says so, and demo profiles can fall back to labeled saved notices once a snapshot is captured. USAspending has its own saved fallback.
- *Does it replace a capture manager?* No. It's decision support, and a person checks every requirement at the source.
