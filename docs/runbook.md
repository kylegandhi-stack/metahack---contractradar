# ContractRadar

## Two-Builder, 36-Hour Execution Runbook

**Project:** Agentic federal contracting intelligence for small
defense-industry suppliers\
**Builders:** Builder 1 (Data, AI, Backend) and Builder 2 (Frontend,
Product, Deployment)\
**Build sprint:** Monday, November 2, 2026 at 7:30 PM PT to Wednesday,
November 4 at 7:30 AM PT\
**Quality and submission buffer:** Wednesday, November 4, 7:30 AM to
3:00 PM PT\
**Official deadline:** Wednesday, November 4, 6:00 PM PT\
**Model:** Meta Muse Spark 1.3, Standard mode\
**Credits:** Each person has \$150 Meta credits; do not assume balances
can be combined.

> **Definition of success:** A publicly reachable web app where a user
> enters a fictional small defense contractor\'s capabilities and
> receives 5-10 **real, source-linked** government procurement records,
> prioritized by a bounded AI workflow. Each result must accurately
> identify whether it is an **active opportunity** or a **historical
> award**. The fifth agent, **Devil\'s Advocate**, challenges
> recommendations and flags unsupported claims, eligibility blockers,
> stale deadlines, and misleading evidence. A complete, repeatable
> 90-second demo must work by Wednesday 3:00 PM.

## 1. Start here: the decision rules

1.  **Ship one complete flow, not many features.** Company profile -\>
    government data -\> agents -\> ranked records -\> challenge review
    -\> detail drawer.
2.  **One model for runtime.** All five logical agents use
    `muse-spark-1.3`; no framework or extra model is needed. Coding
    agents may run on Muse Code independently.
3.  **SAM.gov is conditional.** Its public Opportunities API requires an
    API key. Builder 1 must test access by **Tuesday 10:30 AM**. If
    blocked, the MVP becomes a truthful **historical spending / buyer
    discovery** product, using USAspending records and a clearly labeled
    historical mode. Never mislabel awards as open solicitations.
4.  **No hallucinated procurement facts.** Contract titles, agency, ID,
    amount, set-aside, response deadline, and quotes come from retrieved
    sources, not model generation. Missing fields display \"Unknown\" or
    \"Not provided\".
5.  **Always run the critic.** The Devil\'s Advocate must evaluate the
    top-ranked results. A critical finding must result in a visible
    warning, downgrading, hold, or evidence request; not a hidden note.
6.  **Keep the software simple.** Next.js + TypeScript +
    Tailwind/shadcn + OpenAI SDK configured for Meta + Zod + JSON
    cache + Vercel. No user auth, vector DB, task queue, paid data
    source, or billing.
7.  **Never use sensitive real data.** Use public federal records and
    fictional company profiles only; no controlled unclassified
    information, ITAR-controlled material, or classified content.

### Core product positioning

**Pitch:** \"ContractRadar gives small defense suppliers an AI
business-development team that finds procurement leads, qualifies them,
and argues against bad bids before you waste a week writing a
proposal.\"

**What is NOT promised:** Guaranteed eligibility, a legal/compliance
opinion, an accurate probability of winning, continuously live
procurement coverage, or automatic proposal submission.

### P0 / P1 / excluded

  -----------------------------------------------------------------------
  **Tier**                **Feature**             **Decision**
  ----------------------- ----------------------- -----------------------
  P0                      Fictional company       Must ship
                          profile and preset      
                          example                 

  P0                      Government records      Must ship
                          fetched from            
                          USAspending or SAM.gov, 
                          with verified fallback  
                          cache                   

  P0                      Five visible agent      Must ship
                          stages, with actual     
                          backend agent execution 

  P0                      Ranked cards + result   Must ship
                          detail drawer +         
                          original source link    

  P0                      Separate source         Must ship
                          categories: Open notice 
                          / Early-stage notice /  
                          Historical award        

  P0                      Devil\'s Advocate risk  Must ship
                          flags and final review  
                          status                  

  P0                      Working Vercel          Must ship
                          deployment + testable   
                          demo                    

  P1                      Save shortlist as       Only after P0
                          JSON/CSV; follow-up     
                          question; mini          
                          analytics               

  Excluded                Accounts, recurring     Do not build
                          alerts, PDF OCR,        
                          proposal generation,    
                          RAG database,           
                          auto-bidding, payments  
  -----------------------------------------------------------------------

## 2. Work split and repository rules

  -----------------------------------------------------------------------
  **Area**                **Builder 1: Backend /  **Builder 2: Frontend /
                          Agents**                Product**
  ----------------------- ----------------------- -----------------------
  Primary mission         Make research reliable, Make the product
                          evidence-backed, and    instantly
                          agentic                 understandable and
                                                  demo-ready

  Owns                    `lib/agents/**`,        `app/page.tsx`,
                          `lib/data/**`,          `app/layout.tsx`,
                          `lib/meta.ts`,          `components/**`,
                          `lib/scoring.ts`,       `app/globals.css`,
                          `app/api/**`,           frontend state,
                          `data/**`, test         deployment, demo
                          fixtures                

  Shared contract         Writes `lib/types.ts`   Reviews the contract
                          and `docs/interface.md` before building UI; do
                          in kickoff PR           not change unilaterally

  Feature branch          `feat/backend`          `feat/frontend`

  Test responsibility     Source adapters, agent  User flow,
                          JSON, critiques, score  loading/error states,
                          integrity, fallback     evidence visibility,
                                                  desktop/mobile,
                                                  deployed demo

  Deliverable             `POST /api/research`    Polished UI consuming
                          returning a validated   the typed result
                          typed result            
  -----------------------------------------------------------------------

**Git rule:** Each developer works in a separate local checkout and
feature branch. Protect `main` informally: no direct pushes, no
force-push, no AI-agent merges without human review. Integration PRs are
small. One owner merges at a time. If both must edit `lib/types.ts`,
coordinate by chat first.

### 30-minute kickoff: do exactly this

1.  Builder 2 creates a private GitHub repository `contract-radar`,
    invites Builder 1, scaffolds the Next.js TypeScript app and commits
    it to `main`.
2.  Both clone the repo, install dependencies, run `npm run dev`, and
    verify the page loads locally. Each starts Muse Code or a coding CLI
    pointing at Muse.
3.  Builder 1 creates `docs/interface.md` and `lib/types.ts`, opens a
    tiny PR, and gets Builder 2\'s approval before either agent
    generates many files.
4.  Each developer creates their branch from the latest `main`:

    git switch main
    git pull origin main
    git switch -c feat/backend    # Builder 1 only
    # On Builder 2's machine, use feat/frontend instead.

5.  Share **only environment variable names**, not secrets. Add
    `.env.local` to `.gitignore`. On each machine create `.env.local`
    (or use shell env vars) with `MODEL_API_KEY`; Builder 1 optionally
    adds `SAM_API_KEY`.
6.  Agree on 15-minute overlap/checkpoints at each milestone and keep a
    single shared GitHub Issue titled `P0 launch checklist`.

### Commands for both builders

    # Optional: install Meta's coding agent (macOS/Linux)
    curl -fsSL https://dev.meta.ai/install.sh | sh
    muse

    # Standard Next.js workflow
    npm install
    npm run dev
    npm run lint
    npm run build

    # Before opening each PR
    git status
    git add <files-you-own>
    git commit -m "Describe completed change"
    git push -u origin <your-branch>

Do not give a coding agent unrestricted instructions to rewrite the
repository. Make each task a narrow, independently testable feature. The
two coding agents collaborate **through GitHub**, not through
hypothetical direct agent-to-agent network access.

## 3. Product flow and five runtime agents

**User input:** Company name, capabilities (free text), business size /
claimed certifications (optional), targeted agencies (optional), and a
demo preset. Example: \"AquaVector Systems: 12-person U.S. maker of
hydrophones, underwater acoustic sensors, environmental monitoring
instruments, and ruggedized components for autonomous underwater
vehicles.\" The profile is fictional.

**Sequence:**

1.  **Research Planner** (Muse) extracts capabilities, broadens
    synonyms, suggests search categories, and chooses a bounded research
    plan.
2.  **Opportunity Scout** (Muse tool-calling + server tools) calls
    `search_awards`, optionally `search_sam_notices`, retrieves source
    records, deduplicates and returns 15-30 normalized candidates. Max 3
    search rounds, max 30 candidates.
3.  **Qualification Analyst** (Muse JSON) examines the best 10-12
    candidate records for technical fit, restrictions, missing
    requirements, timing, and evidence. Does not guess unprovided
    details.
4.  **Pursuit Strategist** (Muse JSON) creates a prioritized shortlist
    and actionable next steps. These are **recommendations**, not
    determinations of eligibility or chances of winning.
5.  **Devil\'s Advocate** (fresh Muse call, independently prompted)
    tries to disprove the strategist\'s recommendations. It checks
    misleading data categories, deadlines, unsupported reasoning,
    category mismatches, set-asides, and insufficient source evidence.
    It returns structured objections with severity. Server-side gates
    apply BLOCKER decisions, and the strategist may revise **once** if
    warranted.

**Important:** The agents are *logical roles* in a single server-side
orchestration function. You do not need five independent servers,
workers, or autonomous long-running processes. The Scout is truly
tool-driven; other roles are structured model steps. Each produces
genuine `AgentEvent` objects. For P0, the response includes the
completed activity log; streaming progress is P1, not necessary.

### The Devil\'s Advocate: exact decision contract

The Devil\'s Advocate reviews the top five picks **without trusting the
Strategist\'s conclusions**. Pass it: normalized source records, the
original company profile, analyst notes, and proposed rankings. Do not
pass only the strategist\'s prose. It must identify at least one
possible weakness per top pick **or explicitly say none found after
checking**. It may not invent counterevidence.

  --------------------------------------------------------------------------------------
  **Finding**             **Meaning**             **Required product behavior**
  ----------------------- ----------------------- --------------------------------------
  `BLOCKER`               Verified contradiction: Mark
                          clearly expired         `Hold / Do not pursue as presented`;
                          solicitation, known     prevent a clean recommendation; show
                          disqualifying           cited evidence
                          set-aside, historical   
                          award labeled open,     
                          record/source identity  
                          mismatch                

  `WARNING`               Important unresolved    Display amber warning, decrease
                          issue: unknown          confidence or request verification,
                          certification, unclear  keep visible
                          capability, tight       
                          deadline, low-quality   
                          evidence                

  `NOTE`                  Caveat or additional    Display as advisory
                          diligence question      
  --------------------------------------------------------------------------------------

**Devil\'s Advocate checks:**

-   Is this actually an *open* notice, early-stage inquiry, or
    historical award?
-   Is the response deadline in the past, absent, or ambiguous? Is the
    posted date being mistaken for the closing date?
-   Does a set-aside or geographic requirement contradict company facts?
    If company qualifications are unknown, mark `unknown`, not
    `ineligible`.
-   Does the AI infer experience, security clearance, manufacturing
    capacity, or certifications not mentioned in the source?
-   Does the technical match rest on one shared keyword but not actual
    scope?
-   Is award amount / contract value correctly described, rather than
    assumed available budget?
-   Does every decisive claim point to the correct source record and
    evidence excerpt?
-   Is a winning incumbent or historical buyer being mislabeled as a
    current opportunity?

**Final status rule:** `APPROVED`, `REVIEW_REQUIRED`, or `HOLD`. A
BLOCKER forces HOLD unless verified source evidence resolves it. Unknown
data is not a blocker by itself. The model writes audit findings;
deterministic code is the final enforcement layer.

### Devil\'s Advocate prompt (copy to backend code)

    ROLE: You are ContractRadar's Devil's Advocate, an independent procurement-qualification reviewer. Your job is to challenge the proposed ranking, not endorse it.

    INPUTS: company profile, normalized records with source ids/URLs/excerpts and retrieval times, analyst assessments, and strategist shortlist.

    CHECK: (1) historical award vs current notice, (2) expired/unknown deadline, (3) set-aside/certification mismatch, (4) technical scope mismatch, (5) invented or unattributed facts, (6) unsupported dollar values, (7) misleading fit score and overconfident language.

    For each shortlisted record, return an independent verdict and zero or more findings. Findings must be BLOCKER, WARNING, or NOTE. Each finding must contain: issue, why_it_matters, evidence_source_id (or null when it is a missing-evidence warning), exact supporting excerpt when available, and proposed correction.

    A BLOCKER requires explicit source evidence of a contradiction. Missing data alone is a WARNING. If the evidence does not support a strong claim, demand 'Needs verification'. NEVER invent source text or assume missing certifications mean the company is disqualified.

    Output valid structured JSON only. Do not add unsupported new facts. The final recommendation is still decided by application rules, not by you alone.

### Suggested ranking (clear, conservative)

Compute a **relevance score**, not a win probability: technical fit
(0-40), category alignment (0-20), known eligibility alignment (0-20),
execution scope (0-10), timing (0-10). Missing inputs produce `unknown`,
not fictional certainty. Store each component separately; the total is
displayed as `Fit / 100` with `confidence`. Eligibility is always a
separate enum (`meets_known_requirements`, `needs_verification`,
`known_blocker`). For historical awards, label the numeric output
`Historical relevance` and omit bidding deadline/eligibility claims.

## 4. Data architecture and API contract

### Source priorities and decision deadline

-   **Historical records (always):**
    `POST https://api.usaspending.gov/api/v2/search/spending_by_award/`.
    Public, no authorization required. These are prior federal awards,
    useful for buyer discovery and market intelligence.
-   **Current/early-stage notices (only after successful key test):**
    `GET https://api.sam.gov/opportunities/v2/search` with `api_key`,
    `postedFrom`, `postedTo`, optional `ptype`, `ncode`, `title`. The
    official service requires an API key and a posted date range;
    classify procurement types `o`/`k` as solicitation categories and
    `r`/`p` as early-stage notices, subject to source status
    verification.
-   **Fallback:** `data/verified-records.json`, saved from real public
    API responses with source URLs, source IDs, and `retrievedAt`.
    Display a visible banner `Cached public records - retrieved DATE`.
    Don\'t quietly substitute invented mock contracts.
-   **Hard gate:** If SAM key or API fails by **Tue 10:30 AM**, lock P0
    to the USAspending-only product and change text to
    `Historical buyers and procurement intelligence`. Restore SAM only
    if integration is trivial later.

### Internal TypeScript shape (agree before coding)

    type SourceKind = "open_notice" | "early_stage_notice" | "historical_award";
    type AuditSeverity = "BLOCKER" | "WARNING" | "NOTE";
    type ReviewStatus = "APPROVED" | "REVIEW_REQUIRED" | "HOLD";

    type CompanyProfile = {
      name: string;
      capabilities: string;
      smallBusiness?: boolean | null;
      certifications?: string[];
      targetAgencies?: string[];
    };

    type SourceRecord = {
      id: string;
      source: "sam" | "usaspending";
      kind: SourceKind;
      title: string;
      agency?: string | null;
      description?: string | null;
      url: string;
      retrievedAt: string; // ISO UTC
      postedAt?: string | null;
      deadlineAt?: string | null;
      awardAmount?: number | null;
      setAside?: string | null;
      naics?: string | null;
      excerpts: { text: string; field: string }[];
    };

    type AuditFinding = {
      severity: AuditSeverity;
      issue: string;
      whyItMatters: string;
      evidenceSourceId?: string | null;
      evidenceExcerpt?: string | null;
      correctiveAction: string;
    };

    type RankedResult = {
      record: SourceRecord;
      fitScore: number;
      confidence: "low" | "medium" | "high";
      eligibility: "meets_known_requirements" | "needs_verification" | "known_blocker";
      whyMatched: string[];
      blockers: string[];
      nextSteps: string[];
      findings: AuditFinding[];
      reviewStatus: ReviewStatus;
    };

    type AgentEvent = {
      step: "planner" | "scout" | "analyst" | "strategist" | "devils_advocate";
      status: "started" | "completed" | "failed";
      timestamp: string;
      detail: string;
    };

    type ResearchResponse = {
      profile: CompanyProfile;
      dataMode: "live" | "cached";
      recordsUsed: number;
      results: RankedResult[];
      agentEvents: AgentEvent[];
      runAt: string;
      warnings: string[];
    };

**API:** `POST /api/research` accepts `{ profile: CompanyProfile }`,
validates with Zod, orchestrates the bounded research, and returns
`ResearchResponse`. Return real HTTP errors (429/500) with
understandable messages. Include a deterministic fallback where
appropriate, but mark data mode explicitly. Avoid storing profiles in
production logs.

**Evidence rule:** A source excerpt must be verbatim from the retrieved
data or the field that contains it. An LLM-written explanation is NOT
itself a source. Never generate fabricated procurement URLs. Build
source URLs from official identifiers only when the source documentation
supports that construction; otherwise keep the returned URL.

**Agent budget:** Max 3 Scout tool turns, max 30 candidate records, max
12 deep analyses, max 5 critic reviews, max 1 strategist revision; set
server-side timeout and a per-run token budget. Cache normalized records
and reuse them in repeated demos.

### Minimal Meta client

    import OpenAI from "openai";

    export const meta = new OpenAI({
      apiKey: process.env.MODEL_API_KEY,
      baseURL: "https://api.meta.ai/v1",
    });
    export const MODEL = "muse-spark-1.3";

Use Meta\'s published tool/function-calling and structured JSON
examples. Always validate model responses against Zod on the server. Do
not expose `MODEL_API_KEY` to client-side bundles or use a
`NEXT_PUBLIC_` prefix.

### File ownership map

    contract-radar/
      app/page.tsx                  # Builder 2
      app/globals.css               # Builder 2
      components/                   # Builder 2
      app/api/research/route.ts     # Builder 1
      lib/meta.ts                   # Builder 1
      lib/agents/{planner,scout,analyst,strategist,devils-advocate}.ts # Builder 1
      lib/data/{usaspending,sam,normalize}.ts # Builder 1
      lib/scoring.ts                # Builder 1
      lib/types.ts                  # Builder 1 authors, both approve
      data/verified-records.json   # Builder 1, real sourced records
      docs/interface.md            # Builder 1 authors, both approve
      docs/demo.md                 # Builder 2
      AGENTS.md                     # Both approve
      .env.example                 # Builder 1

## 5. Clock schedule: explicit parallel tasks and exits

> **Time accounting:** Nov 2 at 7:30 PM to Nov 4 at 7:30 AM is 36
> elapsed hours. Use that as the main build sprint, including rest. Wed
> 7:30 AM to 3 PM is contingency/testing/submission time. Times below
> are PT. If starting later, keep the critical gates and cut optional
> features rather than pushing the 3 PM freeze.

### MONDAY, NOVEMBER 2

  -----------------------------------------------------------------------------
  **Time**          **Builder 1 - Backend / **Builder 2 -     **Exit check**
                    Agents**                Frontend /        
                                            Product**         
  ----------------- ----------------------- ----------------- -----------------
  7:30-8:15 PM      Verify Meta key; check  Create repo and   Both clone/build;
                    USAspending docs;       Next.js scaffold; keys never
                    propose schema          invite teammate;  committed
                                            Vercel project    
                                            shell             

  8:15-9:00 PM      Commit `lib/types.ts`,  Review schema     Shared type
                    `docs/interface.md`,    immediately;      contract locked
                    `.env.example` in PR    create page       
                                            layout and design 
                                            system            

  9:00-10:30 PM     Test real USAspending   Company form,     Real record JSON
                    request, normalize 10+  sample preset,    available; usable
                    real records, save      cards with        UI shell
                    source-linked cache     fixture data      
                                            matching schema   

  10:30 PM-12:15 AM First                   Wire frontend to  One end-to-end
                    `POST /api/research`:   route or fixture  record renders
                    records + basic         toggle; detail    locally
                    relevance, no agent     drawer; source    
                    polish yet              links             

  12:15-7:30 AM     Sleep/stop work         Sleep/stop work   Do not trade away
                                                              Tuesday quality
  -----------------------------------------------------------------------------

### TUESDAY, NOVEMBER 3

  ----------------------------------------------------------------------------
  **Time**          **Builder 1 -      **Builder 2 -         **Exit check**
                    Backend / Agents** Frontend / Product**  
  ----------------- ------------------ --------------------- -----------------
  7:30-9:30 AM      Planner + Scout    Polish profile,       Different
                    tool calls;        results,              profiles produce
                    enforce bounded    empty/loading/error   different
                    query loops        states                retrieval plans

  9:30-10:30 AM     Test SAM.gov key;  Add source-kind       SAM GO / NO-GO at
                    decide live        chips, cache banner,  10:30 AM
                    notices vs         source details        
                    historical-only                          
                    path                                     

  10:30 AM-12:30 PM Qualification      Fit breakdown,        5+ records with
                    Analyst JSON +     eligibility badges,   evidence-backed
                    scoring +          confidence, detailed  reasoning
                    citations          evidence UI           

  12:30-1:00 PM     Lunch              Lunch                 Shared sync

  1:00-3:00 PM      Strategist and     Devil\'s Advocate     A known bad
                    independent        panel, final-review   record triggers
                    Devil\'s Advocate; badges, agent         visible
                    apply hard gates   activity timeline     HOLD/WARNING

  3:00-4:30 PM      Backend tests,     Merge backend PR and  Full workflow
                    schema fixes,      connect full flow;    works on both
                    provide final PR   smoke test            machines
                    for integration                          

  4:30-6:00 PM      Test source        Deploy to Vercel;     First live
                    adapters and fix   verify external       deployed version
                    any fatal backend  access, loading and   by 6 PM
                    bugs               links                 

  6:00-7:00 PM      Dinner/break       Dinner/break          Preserve time for
                                                             QA

  7:00-9:00 PM      Regression tests;  Improve interaction   3 repeatable
                    accurate           clarity; rehearse top end-to-end demo
                    classifications,   demo case             runs
                    fallback, cost cap                       

  9:00-11:00 PM     Fix only important Polish,               P0 frozen in a
                    issues; prepare    accessibility,        release candidate
                    cache / backup     capture backup demo   
                    data               if stable             

  11:00 PM-7:30 AM  Sleep/stop work    Sleep/stop work       36-hour core
                                                             sprint ends Wed
                                                             7:30 AM
  ----------------------------------------------------------------------------

### WEDNESDAY, NOVEMBER 4: BUFFER AND SUBMISSION

  -----------------------------------------------------------------------
  **Time**          **Builder 1 -     **Builder 2 -     **Exit check**
                    Backend /         Frontend /        
                    Agents**          Product**         
  ----------------- ----------------- ----------------- -----------------
  7:30-9:30 AM      Test actual       Cross-browser     All P0 tests pass
                    production        desktop demo and  
                    request, source   mobile sanity     
                    outages, critic   check             
                    output, errors                      

  9:30-11:00 AM     Write technical   Record 90-second  Video and pitch
                    architecture and  demo; build       backup ready
                    model use bullets 3-slide verbal    
                                      pitch             

  11:00 AM-12:00 PM Verify each top   Final visual      No misleading
                    result has real   polish; verify    data presentation
                    source, correct   Vercel            
                    type/date         environment       

  12:00-1:00 PM     Lunch, then       Prep submission   Ready to freeze
                    on-call only      fields,           
                                      screenshots,      
                                      links             

  1:00-2:00 PM      Feature freeze,   Deploy stable     `v1-demo` stable
                    check usage       commit, test from 
                    budget, tag       other             
                    release           laptop/network    

  2:00-3:00 PM      Final prod QA and Submit project,   **DONE BY 3 PM**
                    backup recording  verify receipt,   
                    check             leave buffer      

  3:00-6:00 PM      Emergency buffer  Emergency buffer  Official deadline
                    only              only              6 PM
  -----------------------------------------------------------------------

### Required checkpoints (non-negotiable)

-   **Mon 9 PM:** Shared types locked, both coding agents independently
    productive.
-   **Mon 12:15 AM:** Real data appears in a browser, even if ranking is
    simplistic.
-   **Tue 10:30 AM:** SAM decision made; stop waiting for keys.
-   **Tue 3 PM:** Devil\'s Advocate catches at least one seeded flaw.
-   **Tue 6 PM:** Deployed end-to-end application works.
-   **Wed 11 AM:** Demo recording exists and all source links verified.
-   **Wed 1 PM:** Feature freeze; no new features.
-   **Wed 3 PM:** Submitted and verified.

## 6. Builder 1: exact implementation checklist

**MON kickoff**

-   [ ] Verify Meta connection with a tiny server-side
    `chat.completions.create` call using `muse-spark-1.3`.
-   [ ] Create shared interfaces in `lib/types.ts`, sample JSON response
    in `data/sample-research-response.json`, and API contract in
    `docs/interface.md`.
-   [ ] Implement `lib/data/usaspending.ts` with request timeout,
    bounded search terms, status checking, parsing and normalization.
    Use an endpoint request shape copied from current official docs and
    validated against a real response; do not assume every field exists.
-   [ ] Save 10-20 actual source records in `data/verified-records.json`
    with retrieval timestamps; confirm source URLs. Do not edit record
    facts to make matches look better.
-   [ ] Implement minimal `POST /api/research` and commit PR.

**TUE morning**

-   [ ] `planner.ts`: extract 3-6 search terms and 1-3 candidate
    NAICS/PSC categories; mark suggested categories as provisional.
-   [ ] `scout.ts`: model-directed tool calls to `search_awards` and
    optionally `search_sam_notices`; dedupe by source+id; cap tool turns
    and records.
-   [ ] SAM key smoke test; if it fails by 10:30, commit to
    historical-only mode.
-   [ ] `analyst.ts`: structured JSON assessment with source ids,
    component scores, uncertainties, and no invented requirements.
-   [ ] `scoring.ts`: clamp component scores; compute weighted total
    deterministically; include separate eligibility/confidence.

**TUE afternoon**

-   [ ] `strategist.ts`: select top five records, provide action items,
    never predict a win probability.
-   [ ] `devils-advocate.ts`: independent critique using source record
    payloads and strategist picks; structured findings with
    severity/evidence.
-   [ ] `review.ts` or orchestrator: code applies HOLD for verifiable
    BLOCKER; WARNING -\> REVIEW_REQUIRED; revise strategist once only.
-   [ ] Emit real `AgentEvent` items around actual agent calls; capture
    start/end timestamps, errors, and tool invocations.
-   [ ] Validate final response Zod schema before returning. Guarantee
    no historical record is labeled current.
-   [ ] Add tests for ambiguous deadlines, missing source,
    categorization, critique, and fallback.

**WED**

-   [ ] Production sanity test with 2 demo profiles and 1 deliberately
    bad matching record.
-   [ ] Recheck 5 visible records against their original links and
    timestamps.
-   [ ] Provide Builder 2 short architecture description, Meta model
    use, risk limitations, and source acknowledgments.

**Builder 1 definition of done:** a single endpoint returns a typed
response with real records; five actual model roles run in the correct
order; Devil\'s Advocate catches seeded errors; no fabricated citations;
production handles missing SAM key; runtime is budget-bounded.

## 7. Builder 2: exact implementation checklist

**MON kickoff**

-   [ ] Scaffold Next.js (App Router, TypeScript), Tailwind and
    shadcn/ui; create GitHub repo; invite teammate.
-   [ ] Design a professional dark navy/slate dashboard; do not spend
    hours on animation or branding.
-   [ ] Build a company profile form with one-click
    `Use AquaVector demo profile` preset and validation.
-   [ ] Build `OpportunityCard`, `OpportunityDetail`, `AgentActivity`,
    `FindingsPanel`, and top-level dashboard layout based on shared
    types.
-   [ ] Use `data/sample-research-response.json` fixture until the real
    endpoint is ready. Fixture must visibly say `demo/sample` if it is
    not a genuine public record.

**TUE morning**

-   [ ] Wire `fetch('/api/research', { method: 'POST', ... })` with
    loading, timeout, errors, and retry.
-   [ ] Show top matches as ranked cards; provide filters by record kind
    (Open / Early-stage / Historical) and agency only if easy.
-   [ ] Every card must show source badge, government record link, data
    retrieval date, fit score and uncertainty.
-   [ ] Detail drawer must show WHY FITS, LIMITATIONS, EVIDENCE, and
    NEXT ACTIONS distinctly.

**TUE afternoon**

-   [ ] Add five-step agent log; only show genuine steps from
    `AgentEvent` data (P0 displays after completion; don\'t fake
    real-time backend progress).
-   [ ] Add Devil\'s Advocate findings panel with red BLOCKER, amber
    WARNING, grey NOTE, and visible `APPROVED / REVIEW REQUIRED / HOLD`
    status.
-   [ ] Add a non-dismissable cached-data banner when
    `dataMode='cached'`.
-   [ ] Merge PRs after tests; deploy to Vercel by 6 PM. Set the API key
    in Vercel server environment variables; never hardcode it.

**TUE night + WED**

-   [ ] Rehearse exact 90-second demo and trim UI interactions that do
    not help the story.
-   [ ] Test company form, valid request, empty response, invalid API
    key, source link, and a HOLD result.
-   [ ] Record backup 90-second demo video and screenshot the final
    dashboard.
-   [ ] Own project submission, description, demo link, video link, team
    attribution, and 3 PM submission checkpoint.

**Builder 2 definition of done:** a first-time judge can enter a
profile, watch/review five agent stages, distinguish historical vs
active leads, inspect real evidence and a Devil\'s Advocate challenge,
and understand the recommendation in under 90 seconds.

## 8. Agent instructions for the two coding assistants

**Builder 1: paste this into your coding assistant**

    You are Builder 1, backend lead for ContractRadar in a two-developer hackathon. Deadline: Wednesday Nov 4, 2026, 3 PM PT. Work only on backend-owned files, on branch feat/backend. Read docs/interface.md first. Use Meta Muse Spark 1.3 with the OpenAI-compatible API; do not introduce another model or framework.

    Implement source-backed USAspending retrieval, optional SAM.gov notice retrieval if our key works, normalization, caching, planner/scout/analyst/strategist/devils-advocate agents, bounded tool calls, and Zod validation. Deliver POST /api/research conforming to shared types. Make the critic truly independent and require every claim to be supported by source fields. Differentiate historical awards, early-stage notices, and current solicitations. Never invent awards, dates, eligibility or values. Include deterministic safety gates and tests. Do not modify frontend files. Commit small, buildable changes and report remaining integration steps.

**Builder 2: paste this into your coding assistant**

    You are Builder 2, frontend and demo lead for ContractRadar in a two-developer hackathon. Deadline: Wednesday Nov 4, 2026, 3 PM PT. Work only on frontend-owned files, on branch feat/frontend. Read docs/interface.md and lib/types.ts first.

    Build a polished professional Next.js/Tailwind/shadcn dashboard with a fictional company profile preset, 5-stage agent activity, ranking cards, evidence-backed detail drawer, Devil's Advocate warning panel, source-kind labels, and cached-data banner. Consume the typed POST /api/research contract. Use fixture JSON until the backend is merged. Do not fake source links or progress; the interface must visibly separate open notices from historical awards. Own Vercel deployment, demo recording, accessibility basics and final submission. Keep commits small and do not alter backend files without agreement.

**Optional coding-code reviewer instruction:** At each PR, ask a third
read-only session: \"Review this diff for interface breakage, secrets,
source misclassification, invented facts, and lack of tests. Do not edit
code. Output only prioritized actionable findings.\" Do not spend time
setting up more autonomous coding agents.

## 9. Tests: adversarial acceptance suite

The test suite is as important as the polished UI. Seed a few **clearly
marked synthetic test records** for unit tests only; do not present them
in the demo as real procurement records.

  ------------------------------------------------------------------------
  **Test**                **Input scenario**      **Expected behavior**
  ----------------------- ----------------------- ------------------------
  T1                      Real relevant           Labeled HISTORICAL; no
                          historical award        apply-now CTA or closing
                                                  date fiction

  T2                      Actual open             Labeled OPEN only if
                          solicitation with       source/status/deadline
                          future response date    verification supports it

  T3                      Expired solicitation    Devil flags BLOCKER;
                                                  `reviewStatus=HOLD`

  T4                      Explicit set-aside      BLOCKER with source
                          conflicting with known  evidence; hold
                          company facts           

  T5                      Certification not       `needs_verification`,
                          provided by company     not invented
                                                  ineligibility

  T6                      Same keyword but        Low technical fit;
                          unrelated actual scope  critic flags misleading
                                                  semantic match

  T7                      Missing or conflicting  Do not approve
                          source/ID               unsupported claim; show
                                                  error or hold

  T8                      Missing SAM key or      Return labeled cached
                          429/500 upstream        public records or useful
                                                  error; no silent
                                                  hallucination

  T9                      Model emits invalid     Validate, retry at most
                          JSON                    once or fail gracefully

  T10                     Critic raises a valid   Warning/HOLD visible in
                          concern                 the resulting card and
                                                  detail drawer

  T11                     Backend request takes   Timeout with retry UI;
                          too long                do not spin forever

  T12                     Two consecutive runs    Stable source
                                                  identifiers, no
                                                  duplicate records,
                                                  reasonable costs
  ------------------------------------------------------------------------

**Demo rehearsal script:** (0-15s) fictional marine sensor company
profile. (15-30s) execute search and explain five agents. (30-55s) show
ranked real procurement records with sources. (55-75s) open a result and
cite technical fit. (75-90s) expand Devil\'s Advocate: \"The AI found a
risk and prevented a misleading recommendation.\" Avoid promising a
particular live result until you have tested the exact data.

## 10. Budget, risk controls, and scope-cut triggers

-   Each person\'s \$150 Meta grant is independent. Verify which API
    keys and product usage are covered; use Standard mode unless you
    explicitly accept Contributor mode data terms.
-   Reserve at least $40 -$`50 of each person\'s credits
    for Wednesday, unless grant economics turn out different. There is
    no need to spend the budget.
-   Log token usage and count calls by stage; 5 logical agents do NOT
    mean infinite parallel API requests.
-   Use fixed candidate limits, one critic pass, one possible strategist
    revision, and a per-run cost/time cap.
-   Never commit `.env.local`; verify `MODEL_API_KEY` is used only on
    the server. Do not print it in logs or screenshots.
-   If by **Tue 10:30 AM** no SAM access, do historical-award
    intelligence well.
-   If by **Tue 3 PM** five-stage pipeline does not run, remove all P1
    features and focus on critic integration.
-   If by **Tue 6 PM** deployment fails, pause feature work and fix
    deployment.
-   If by **Wed 11 AM** the live demo is unreliable, use verified cached
    records and the already-recorded backup.
-   At **Wed 1 PM**, no new features and no schema churn. Submit by 3
    PM, not by the official 6 PM deadline.

### What to say when asked by judges

**Why Meta?** Muse Spark 1.3 drives all five agent stages, tool use,
evidence-grounded qualification, structured scoring explanations, and an
independent adversarial critique. The core product logic, not just the
UI, depends on Meta\'s model.

**Why agentic?** The Scout chooses and invokes real retrieval tools,
qualification is evidence-conditioned, and a separate critic can
overturn an earlier recommendation. A deterministic server enforces
record-type and safety gates.

**What\'s defensible?** Niche workflow, procurement-specific data
normalization, source attribution, checks against misleading bids, and
an explainable UI. Not a claim of a breakthrough foundation model.

**What comes next?** Verified live solicitations, opportunity alerts,
company-specific compliance profiles, teaming-partner discovery, and
secure document workspaces. None is required for the hackathon.

## 11. Authoritative sources for builders

1.  Meta Model API overview and supported models:
    <https://dev.meta.ai/docs/overview>
2.  Meta Muse Code quickstart: <https://dev.meta.ai/docs/quickstart>
3.  Meta tool/function calling:
    <https://dev.meta.ai/docs/cookbook/tool-function-calling>
4.  Meta structured JSON output:
    <https://dev.meta.ai/docs/cookbook/structured-output>
5.  USAspending API endpoints:
    <https://api.usaspending.gov/docs/endpoints>
6.  GSA SAM.gov Opportunities API:
    <https://open.gsa.gov/api/get-opportunities-public-api/>
7.  GitHub pull requests overview:
    <https://docs.github.com/en/pull-requests>

**Final operating rule:** If a task does not improve the single
end-to-end demo or make its claims more trustworthy, postpone it. Five
trustworthy agent stages with one crisp Devil\'s Advocate intervention
will outperform a sprawling unfinished product.
