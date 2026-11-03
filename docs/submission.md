# Rauros Systems: hackathon submission

**One-line pitch:** Five Muse Spark agents find the federal contracts worth bidding, then argue against them before a small defense supplier spends a week on a proposal.

**Track:** Indie

**Live app:** https://metahack-contractradar.vercel.app

**Code:** https://github.com/kylegandhi-stack/metahack---contractradar

## The problem

A small defense supplier can lose a week on a proposal it was never going to win.

## What it does

Describe your company, and five agents search real U.S. federal procurement records, qualify each one against your capabilities, and challenge their own recommendations. Every result links to its official source record and carries a status: `APPROVED`, `REVIEW_REQUIRED` or `HOLD`. It's decision support, not a bid decision or legal advice.

## How the five agents work

All five run on Meta's Muse Spark 1.3, with no other model or agent framework at runtime.

1. **Research Planner** keeps the company's product phrases word for word, then adds search variations and candidate NAICS and PSC codes.
2. **Opportunity Scout** uses tool calling to choose and run real searches.
3. **Qualification Analyst** scores records against a rubric, citing evidence.
4. **Pursuit Strategist** picks the top 5 from the 8 best-scoring records, with next steps.
5. **Devil's Advocate** reviews each shortlisted record in a separate call, looking for what's wrong.

**The model writes findings, but code decides the status.** A passed deadline means `HOLD`, and a model's blocker only stands if it cites text really in the source record.

## What's new

Santiago Cavalieri and Kyle Gandhi built this from scratch during the hackathon, with AI coding assistants helping write the code. It didn't start from an earlier codebase, and the public commit history shows the work. Not original: the `create-next-app` scaffold, open-source packages, public procurement records and public-domain U.S. Navy imagery.

## Data sources

- **USAspending.gov:** past contract awards and buyer history.
- **SAM.gov:** current notices.

Official records remain authoritative. This project isn't affiliated with or endorsed by these agencies, the U.S. Navy, the Department of Defense or Meta.

## Accuracy

Hand-labeled precision@5 on the current search: **[PRECISION@5: fill in after the 4 PM eval]**.

This number comes from one labeled run.
