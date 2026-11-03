# Release checklist: Tuesday 4 PM run through submission

**Santiago** is Builder 1 (backend and data). **Kyle** is Builder 2 (frontend, deployment, video and submission). Times are Pacific. Coding agents can prepare and run most steps, but a human approves each decision and merge.

**Starts:** Tuesday at 4 PM, when the SAM.gov quotas reset. No SAM.gov calls before then.

**Wednesday deadlines:** recording by 11 AM, feature freeze at 1 PM, submitted and verified by **3 PM**. The official deadline is 6 PM.

## SAM.gov call budget

Treat each key as **10 calls for this whole period**. Quotas reset at 4 PM PT, so Tue 4 PM to Wed 4 PM is one budget, and it covers everything up to submission. These are third-party figures, not confirmed by GSA.

| Key | Step | Calls |
|---|---|---|
| Santiago's (local) | "After" eval | 2 |
| Santiago's (local) | Snapshot capture | up to 7 |
| Santiago's (local) | **Spare** | **1** |
| Kyle's (production) | Final check, 2 runs | 4 |
| Kyle's (production) | Rehearsal and recording, up to 3 runs | 6 |

- Each production run uses 2 calls while `SAM_DESCRIPTIONS` and `SAM_IDENTITY_LOOKUPS` stay **unset**. Turning either on spends up to 5 more per run.
- Count production usage in Vercel Logs: the `research run` line has `"sam":{"requests":N,"throttled":bool}`.
- If Kyle confirms a higher-quota key, this budget no longer applies.

## Steps

| # | Target | Step | Owner | Done when |
|---|---|---|---|---|
| 1 | Tue, before 3:50 PM | Merge #42 → #45 → #47 → #48, plus #43 | Kyle | Production deployed from `main` |
| 1b | Tue 3:50 PM | Pull `main` fresh | Santiago | Local `main` matches `origin/main` |
| 2 | Tue 4:00 PM | "After" eval | Santiago | Sheet labeled and scored |
| 3 | Tue, after step 2 | Snapshot capture | Santiago | Snapshot merged and deployed |
| 4 | Tue, after step 3 deploys | Final production check | Santiago runs, Kyle watches logs | All checks below pass |
| 5 | Tue, after step 4 | Link spot-check | Santiago | Top 5 match their sources |
| 6 | Wed, by 11:00 AM | Fill in the script, time it, record | Kyle | Video is under 3:00 |
| 7 | Wed, by 1:00 PM | Feature freeze and `v1-demo` tag | Kyle, Santiago confirms | Tag pushed |
| 8 | Wed, by 3:00 PM | Submit and verify | Kyle | Receipt confirmed |

**Don't start step 2 until #47 is merged.** The eval has to measure the code being shipped. If #47 isn't merged at 4 PM, wait: the quota budget lasts until Wed 4 PM.

**Kyle needs to be available after the capture** to merge the snapshot PR, because step 4 runs on the deployed snapshot.

**Run the "after" eval before the capture.** It costs 2 calls and is the first real test of `ccode`, so a problem shows up before the 7-call capture spends the rest.

### 1. Merges and fresh pull (Kyle, then Santiago, no SAM.gov calls)

- [ ] Kyle merges in this order: #42, #45, #47, #48. #47 and #48 are both built on #45.
- [ ] Kyle merges #43 before 4 PM, because step 4 tests the rate limit. #44 can merge any time.
- [ ] Production is deployed from `main`.
- [ ] At 3:50 PM, Santiago pulls `main`, so the eval measures merged code:

```bash
git fetch origin && git checkout main && git pull --ff-only origin main
```

### 2. "After" eval (Santiago, 2 calls)

```bash
npx tsx --env-file=.env.local scripts/labeling-sheet-after.mts
```

- [ ] Output says `SAM.gov calls: 2`, with SAM.gov notices in the top 10. If it stops with a SAM.gov error, nothing is written, and **the attempt still counts**.
- [ ] Label `data/eval/labeling-sheet-after.csv` by scope only, using the same rule as last time.
- [ ] Score it: `npm run eval:sheet data/eval/labeling-sheet-after.csv`
- [ ] Add the number to `README.md`, `docs/architecture.md` and `docs/pitch-notes.md`, keeping the caveat: one run, one labeler, and it isn't like for like with the "before" runs, which used a shorter profile and were all notices.
- [ ] If the number is worse than before, report it honestly and decide together. Don't rerun until it looks better.

### 3. Snapshot capture (Santiago, up to 7 calls)

Saved real notices let the demo keep working if production runs out of quota.

```bash
npx tsx --env-file=.env.local scripts/fetch-sam-snapshot.mts
```

- [ ] Output reports notices and descriptions saved. It writes nothing if the SAM.gov search failed.
- [ ] **Check the description count.** This is the first real test of `noticedesc`. If it's 0, the response shape is wrong: note it and move on, since runs still work without descriptions.
- [ ] Open a PR with `data/sam-snapshot.json`. Never edit its facts by hand.
- [ ] Kyle merges, and production redeploys.

### 4. Final production check (Santiago, 4 calls on Kyle's key)

Run against https://metahack-contractradar.vercel.app:

- [ ] **AquaVector preset:** 200, under 90 s, `dataMode: live`, notices in the results.
- [ ] **Second profile** (`[TEST] Northgate Composites`): 200, under 90 s, relevant results.
- [ ] **Bad requests:** invalid JSON and a missing profile each return 400.
- [ ] **Expired notices:** every result past its deadline is `HOLD` and shows **Expired** in the UI.
- [ ] **Response quality:** valid schema, all five agents logged, top results relevant, at most 2 of the same item.
- [ ] **Run time recorded.** This is the first full run with live SAM.gov. If it's over 90 s, tell Santiago before recording.
- [ ] **Logs:** `sam.requests` is 2 and `throttled` is false.
- [ ] **Rate limit:** on a Vercel preview with `RATE_LIMIT_PER_IP=1` and **no `SAM_API_KEY`**, a second quick run returns 429. This uses no SAM.gov calls and proves the address headers work on Vercel.

### 5. Link spot-check (Santiago, no API calls)

Open the top 5 source links from the final check in a browser, not with an API call, since SAM.gov can answer 200 to any path.

- [ ] Title, agency, notice type, posted date, deadline, set-aside and NAICS match.
- [ ] USAspending results: amount, dates and recipient also match.
- [ ] Time zones can differ: `16:30-04:00` and `3:30 PM EST` are the same moment.
- [ ] Fix any mismatch at the source of the bug. Never edit facts by hand.

### 6. Recording (Kyle)

- [ ] Run the AquaVector preset and fill in the bracketed lines in `docs/pitch-notes.md` from that run.
- [ ] Confirm a suitable expired HOLD is on screen. The DT-511C/DT-592D notice was the expected one; SAM.gov lists it as inactive from Nov 14.
- [ ] Time a full read. **The video must be under 3:00 including title and end screens.** The script targets about 2:45.
- [ ] If a cached banner appears, keep it on screen and say saved records are being used.
- [ ] Keep at least 1 run in reserve for a live check before submitting.

### 7. Feature freeze and tag (Kyle, Santiago confirms)

From 1 PM there are no new features and no contract changes. Fixes go in only if both of you agree.

- [ ] `main` passes: `npm run lint && npm run build && npm test`
- [ ] Vercel production is deployed from the same commit as the tag.
- [ ] `SAM_DESCRIPTIONS` and `SAM_IDENTITY_LOOKUPS` are unset in Vercel, unless you've both decided otherwise.
- [ ] Tag it. Tagging is a human step:

```bash
git checkout main && git pull
git tag -a v1-demo -m "Hackathon demo release"
git push origin v1-demo
```

**If a release breaks after this:** promote the previous good deployment in Vercel rather than rushing a fix.

### 8. Submit and verify (Kyle, by 3 PM)

- [ ] The live URL works in a private window with no sign-in.
- [ ] The repo is public, and the README's accuracy numbers match the latest results and caveats.
- [ ] The video link plays signed out and is under 3:00.
- [ ] The submission name, description and team details are right.
- [ ] **Santiago:** rerun the secret scan: no `.env` files other than `.env.example` in history, and no real key values anywhere.
- [ ] Save the submission receipt and comment on #1.

## If something goes wrong

| Problem | What to do |
|---|---|
| SAM.gov returns 429 on production | The preset falls back to the labeled snapshot, if captured. Keep the banner on screen, and other profiles show awards only |
| Meta API fails | Runs return a clean error. Check the Meta dashboard, then retry |
| Live demo is unreliable by 11 AM | Record with verified cached records, per the runbook, labeled as cached |
| Rate limit blocks a take | Raise `RATE_LIMIT_PER_IP` in Vercel and redeploy |
| A number looks too good | Check it before saying it. Small samples stay labeled as small |
