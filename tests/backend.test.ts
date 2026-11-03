// Runbook section 9 acceptance suite. Records here are synthetic, titled [TEST], and never shown in
// the demo. T11's client side (retry UI) belongs to Builder 2; live runs are in tests/live-seeded.mts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { z } from "zod";
import { keepVerified, type Assessment } from "../lib/agents/analyst";
import { DEVILS_ADVOCATE_PROMPT } from "../lib/agents/devils-advocate";
import { NoUsableDataError, runResearch, type PipelineDeps } from "../lib/agents/orchestrator";
import type { ResearchPlan } from "../lib/agents/planner";
import type { ScoutResult } from "../lib/agents/scout";
import { clearScoutMemo, MAX_TOOL_TURNS, runScout } from "../lib/agents/scout";
import { loadVerifiedRecords } from "../lib/data/cache";
import { loadSamSnapshot } from "../lib/data/snapshot";
import { verifyRecords } from "../lib/data/verify";
import { findPriorAwards, subtierFromPath, titleTerms } from "../lib/data/buyer-history";
import {
  classifyNotice,
  clearDescriptionMemo,
  collapseNotices,
  describeNotices,
  normalizeNotice,
  searchNotices,
} from "../lib/data/sam";
import { cleanKeywords, dedupeRecords, normalizeAward, searchAwards } from "../lib/data/usaspending";
import { computeMetrics, EvalFileSchema } from "../lib/eval";
import { chatJson, MetaError, parseJsonOutput, RunBudget } from "../lib/meta";
import { applyGates, capCriticWarnings, isVerbatim, statusFromFindings, verifyCriticFinding } from "../lib/review";
import { ResearchResponseSchema, SourceRecordSchema } from "../lib/schemas";
import { computeFit, finalConfidence } from "../lib/scoring";
import type { AuditFinding, CompanyProfile, RankedResult, SourceRecord } from "../lib/types";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const PROFILE: CompanyProfile = {
  name: "[TEST] Sensor Co",
  capabilities: "Maker of hydrophones and underwater acoustic sensors.",
  smallBusiness: true,
  certifications: [],
};

function notice(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "TEST-NOTICE-1",
    source: "sam",
    kind: "open_notice",
    title: "[TEST] Hydrophone assemblies",
    agency: "[TEST] Department of the Navy",
    description: null,
    url: "https://sam.gov/workspace/contract/opp/test/view",
    retrievedAt: "2026-11-03T11:00:00.000Z",
    postedAt: "2026-10-01",
    deadlineAt: "2026-11-30T16:30:00-05:00",
    awardAmount: null,
    setAside: null,
    naics: "334511",
    excerpts: [{ field: "title", text: "[TEST] Hydrophone assemblies" }],
    ...overrides,
  };
}

function award(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    ...notice(),
    id: "CONT_AWD_TEST_1",
    source: "usaspending",
    kind: "historical_award",
    title: "[TEST] Hydrophone delivery order",
    url: "https://www.usaspending.gov/award/CONT_AWD_TEST_1",
    deadlineAt: null,
    awardAmount: 100000,
    excerpts: [{ field: "Description", text: "[TEST] Hydrophone delivery order" }],
    ...overrides,
  };
}

const PLAN: ResearchPlan = {
  capabilities: ["hydrophones"],
  searchTerms: ["hydrophone"],
  categories: [],
  rationale: "test",
};

function assessment(sourceId: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    sourceId,
    technical: 30,
    category: 15,
    eligibility: 10,
    execution: 5,
    timing: 5,
    confidence: "high",
    whyMatched: ["Scope names hydrophones"],
    uncertainties: [],
    evidence: [{ field: "title", text: "[TEST] Hydrophone" }],
    ...overrides,
  };
}

function scoutWith(records: SourceRecord[], overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    records,
    toolCalls: ["search_awards(hydrophone)"],
    turns: 1,
    usaspendingFailure: null,
    usaspendingSucceeded: true,
    samFailure: null,
    samThrottled: false,
    modelDirected: true,
    ...overrides,
  };
}

function fakeDeps(records: SourceRecord[], overrides: Partial<PipelineDeps> = {}): Partial<PipelineDeps> {
  return {
    plan: async () => PLAN,
    scout: async () => scoutWith(records),
    analyze: async (_profile, list) => list.map((record) => assessment(record.id)),
    strategize: async (_profile, list) =>
      list.slice(0, 5).map((record) => ({ sourceId: record.id, rationale: "Fits", nextSteps: ["Verify scope"] })),
    revise: async (_profile, shortlist) => shortlist,
    critique: async (_profile, _records, _assessments, shortlist) =>
      shortlist.map((pick) => ({ sourceId: pick.sourceId, verdict: "Checked", noneFound: true, findings: [] })),
    enrich: async (record) => record,
    describe: async () => ({ texts: new Map(), unavailable: [], shortened: [] }),
    loadSnapshot: () => null,
    verify: async () => new Map(),
    history: async () => new Map(),
    descriptionsEnabled: () => true,
    samConfigured: () => true,
    now: () => NOW,
    ...overrides,
  };
}

const realFetch = globalThis.fetch;
const realSamKey = process.env.SAM_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realSamKey === undefined) delete process.env.SAM_API_KEY;
  else process.env.SAM_API_KEY = realSamKey;
  clearScoutMemo();
});

test("T1: a real-shaped award is historical, has no deadline, and gets no bid step", async () => {
  const record = normalizeAward(
    {
      generated_internal_id: "CONT_AWD_X_9700",
      "Award ID": "X",
      Description: "DT-574 HYDROPHONE",
      "Award Amount": 5,
      NAICS: { code: "334511", description: "NAV" },
      "Awarding Agency": "Department of Defense",
    },
    "2026-11-03T00:00:00.000Z",
  );
  assert.ok(record);
  assert.equal(record.kind, "historical_award");
  assert.equal(record.deadlineAt, null);
  assert.equal(record.url, "https://www.usaspending.gov/award/CONT_AWD_X_9700");
  assert.ok(record.excerpts.some((entry) => entry.field === "Description" && entry.text === "DT-574 HYDROPHONE"));

  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([award()], {
      strategize: async () => [
        {
          sourceId: "CONT_AWD_TEST_1",
          rationale: "Fits",
          nextSteps: ["Submit a proposal by Friday", "Apply now"],
        },
      ],
    }),
  });
  const [result] = response.results;
  assert.equal(result.record.kind, "historical_award");
  assert.equal(result.fitBreakdown?.timing, null);
  assert.equal(result.fitBreakdown?.eligibility, null);
  assert.ok(result.nextSteps.every((step) => !/submit|apply/i.test(step)));
});

test("T1: schema rejects a historical record labeled current or carrying a deadline", () => {
  assert.equal(SourceRecordSchema.safeParse(award({ kind: "open_notice" })).success, false);
  assert.equal(SourceRecordSchema.safeParse(award({ deadlineAt: "2027-01-01" })).success, false);
});

test("T2: solicitation types classify as open only by notice type", () => {
  assert.equal(classifyNotice("Solicitation"), "open_notice");
  assert.equal(classifyNotice("Combined Synopsis/Solicitation"), "open_notice");
  assert.equal(classifyNotice("Sources Sought"), "early_stage_notice");
  assert.equal(classifyNotice("Presolicitation"), "early_stage_notice");
  for (const other of ["Award Notice", "Justification", "Special Notice", "", null]) {
    assert.equal(classifyNotice(other), null);
  }
});

test("T2: a future solicitation passes with no deadline finding", () => {
  const gate = applyGates(notice({ setAside: "No Set aside used" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(gate.findings), "APPROVED");
  assert.equal(gate.eligibility, "meets_known_requirements");
  assert.equal(applyGates(notice({ setAside: null }), PROFILE, 30, NOW).eligibility, "needs_verification");
});

test("T2: only official SAM links from the source are kept", () => {
  const raw = {
    noticeId: "abc",
    title: "T",
    type: "Solicitation",
    active: "Yes",
    uiLink: "https://sam.gov/workspace/contract/opp/abc/view",
  };
  assert.equal(normalizeNotice(raw, "2026-11-03T00:00:00.000Z")?.url, raw.uiLink);
  assert.equal(normalizeNotice({ ...raw, uiLink: "https://evil.example/abc" }, "2026-11-03T00:00:00.000Z"), null);
  assert.equal(normalizeNotice({ ...raw, active: "No" }, "2026-11-03T00:00:00.000Z"), null);
});

test("T3: an expired solicitation, even when active, gets a BLOCKER and HOLD", async () => {
  const expired = notice({ deadlineAt: "2026-10-22T16:30:00-04:00" });
  const gate = applyGates(expired, PROFILE, 30, NOW);
  const blocker = gate.findings.find((finding) => finding.severity === "BLOCKER");
  assert.equal(blocker?.evidenceExcerpt, "2026-10-22T16:30:00-04:00");

  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([expired, notice({ id: "TEST-NOTICE-2" })]),
  });
  const held = response.results.find((result) => result.record.id === expired.id);
  assert.equal(held?.reviewStatus, "HOLD");
  assert.equal(held?.confidence, "low");
  assert.equal(response.results.at(-1)?.record.id, expired.id, "HOLD sorts last and stays visible");
});

test("ambiguous or missing deadlines warn and never pass as open", () => {
  for (const deadlineAt of ["sometime soon", null]) {
    const { findings } = applyGates(notice({ deadlineAt }), PROFILE, 30, NOW);
    assert.equal(statusFromFindings(findings), "REVIEW_REQUIRED");
    assert.ok(findings.every((finding) => finding.severity !== "BLOCKER"));
  }
});

test("a deadline within 3 days warns", () => {
  const { findings } = applyGates(notice({ deadlineAt: "2026-11-04T12:00:00Z" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(findings), "REVIEW_REQUIRED");
});

test("T4: an explicit set-aside against known company facts is a BLOCKER with evidence", () => {
  const setAside = "Total Small Business Set-Aside (FAR 19.5)";
  const gate = applyGates(notice({ setAside }), { ...PROFILE, smallBusiness: false }, 30, NOW);
  assert.equal(gate.eligibility, "known_blocker");
  assert.equal(statusFromFindings(gate.findings), "HOLD");
  assert.equal(gate.findings[0].evidenceExcerpt, setAside);
});

test("T5: a certification the company did not list is needs_verification, not ineligible", () => {
  for (const setAside of ["8(a) Set-Aside", "HUBZone Set-Aside", "Women-Owned Small Business (WOSB)"]) {
    const gate = applyGates(notice({ setAside }), PROFILE, 30, NOW);
    assert.equal(gate.eligibility, "needs_verification", setAside);
    assert.ok(gate.findings.every((finding) => finding.severity !== "BLOCKER"), setAside);
    assert.equal(statusFromFindings(gate.findings), "REVIEW_REQUIRED", setAside);
  }
});

test("T5: a listed certification raises no warning, unknown size asks for verification", () => {
  const held = applyGates(notice({ setAside: "8(a) Set-Aside" }), { ...PROFILE, certifications: ["8(a)"] }, 30, NOW);
  assert.equal(statusFromFindings(held.findings), "APPROVED");
  const unknownSize = applyGates(
    notice({ setAside: "Total Small Business" }),
    { ...PROFILE, smallBusiness: null },
    30,
    NOW,
  );
  assert.equal(unknownSize.eligibility, "needs_verification");
});

test("no set-aside text forms are not treated as restrictions", () => {
  for (const setAside of ["No Set aside used", "NO SET ASIDE USED.", "NONE", "None"]) {
    assert.equal(applyGates(notice({ setAside }), PROFILE, 30, NOW).eligibility, "meets_known_requirements", setAside);
  }
});

test("T6: same keyword but unrelated scope gets a low technical warning", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice({ title: "[TEST] Acoustic ceiling tile installation" })], {
      analyze: async (_profile, list) => list.map((record) => assessment(record.id, { technical: 4 })),
    }),
  });
  const [result] = response.results;
  assert.equal(result.fitBreakdown?.technical, 4);
  assert.notEqual(result.reviewStatus, "APPROVED");
  assert.ok(result.findings.some((finding) => /low technical/i.test(finding.issue)));
});

test("T7: identity problems block, and a non-verbatim BLOCKER cannot force HOLD", () => {
  const badHost = applyGates(notice({ url: "https://example.com/x" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(badHost.findings), "HOLD");
  assert.equal(statusFromFindings(applyGates(notice({ excerpts: [] }), PROFILE, 30, NOW).findings), "HOLD");

  const record = notice();
  const invented = verifyCriticFinding(
    {
      severity: "BLOCKER",
      issue: "Requires top secret clearance",
      why_it_matters: "x",
      evidence_source_id: record.id,
      exact_supporting_excerpt: "Top secret clearance is required",
      proposed_correction: "Drop it",
    },
    record,
  );
  assert.equal(invented.severity, "WARNING");
  assert.equal(invented.evidenceExcerpt, null, "invented text is never displayed as evidence");

  const wrongSource = verifyCriticFinding(
    {
      severity: "BLOCKER",
      issue: "Mismatch",
      why_it_matters: "x",
      evidence_source_id: "OTHER",
      exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
      proposed_correction: "Check",
    },
    record,
  );
  assert.equal(wrongSource.severity, "WARNING");
  assert.equal(wrongSource.evidenceSourceId, null);
});

test("T7: analyst evidence not found in the record is removed and lowers confidence", () => {
  const record = notice();
  const [kept] = keepVerified(
    [assessment(record.id, { evidence: [{ field: "title", text: "Invented requirement" }] })],
    [record],
  );
  assert.deepEqual(kept.evidence, []);
  assert.equal(kept.confidence, "low");
  assert.deepEqual(keepVerified([assessment("UNKNOWN-ID")], [record]), []);
  assert.equal(isVerbatim("[test]   hydrophone", record), true);
});

test("T8: every source down returns labeled cached public records, never invented ones", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([], {
      scout: async () =>
        scoutWith([], { usaspendingSucceeded: false, usaspendingFailure: "USAspending returned HTTP 500" }),
    }),
  });
  const cache = loadVerifiedRecords();
  assert.ok(cache);
  assert.equal(response.dataMode, "cached");
  assert.ok(response.warnings.some((warning) => warning.includes("HTTP 500") && warning.includes(cache.retrievedAt)));
  const ids = new Set(cache.records.map((record) => record.id));
  assert.ok(response.results.length > 0);
  assert.ok(response.results.every((result) => ids.has(result.record.id)));
});

test("T8: no cache gives a clear error, not an empty success", async () => {
  await assert.rejects(
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps([], {
        scout: async () => scoutWith([], { usaspendingSucceeded: false }),
        loadCache: () => null,
      }),
    }),
    NoUsableDataError,
  );
});

test("T8: missing SAM key warns, and a live empty search does not fall back to the cache", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([], { samConfigured: () => false }),
  });
  assert.equal(response.dataMode, "live");
  assert.deepEqual(response.results, []);
  assert.ok(response.warnings.some((warning) => warning.includes("historical awards only")));
  delete process.env.SAM_API_KEY;
  await assert.rejects(searchNotices({ title: "hydrophone" }), /not configured/);
});

test("T8: SAM errors never expose the key", async () => {
  process.env.SAM_API_KEY = "secret-test-key";
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  const error = await searchNotices({ title: "hydrophone" }).catch((caught: Error) => caught);
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes("secret-test-key"));
  assert.match(error.message, /429/);
});

test("T8: USAspending HTTP errors and malformed bodies raise instead of returning fake data", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  await assert.rejects(searchAwards({ keywords: ["hydrophone"] }), /HTTP 500/);
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(searchAwards({ keywords: ["hydrophone"] }), /no results array/);
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  assert.deepEqual(await searchAwards({ keywords: ["ab", " "] }), [], "keywords under 3 chars are never sent");
  assert.deepEqual(cleanKeywords(["Sonar", "sonar ", "ab"]), ["Sonar"]);
});

test("T9: invalid model JSON is rejected before it reaches the pipeline", () => {
  const schema = z.object({ terms: z.array(z.string()) });
  assert.deepEqual(parseJsonOutput('{"terms":["a"]}', schema), { ok: true, value: { terms: ["a"] } });
  for (const bad of ["not json", '{"terms":"a"}', "", null]) {
    assert.equal(parseJsonOutput(bad, schema).ok, false);
  }
});

test("T10: a verified critic concern is visible on the result and sets its status", async () => {
  const record = notice();
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      critique: async () => [
        {
          sourceId: record.id,
          verdict: "Bad",
          noneFound: false,
          findings: [
            {
              severity: "BLOCKER",
              issue: "Title contradicts the record",
              why_it_matters: "Identity mismatch",
              evidence_source_id: record.id,
              exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
              proposed_correction: "Hold",
            },
          ],
        },
      ],
    }),
  });
  const [result] = response.results;
  assert.equal(result.reviewStatus, "HOLD");
  assert.deepEqual(result.blockers, ["Title contradicts the record"]);
  assert.equal(result.findings[0].evidenceExcerpt, "[TEST] Hydrophone assemblies");
  assert.ok(ResearchResponseSchema.safeParse(response).success);
});

test("T10: no verdict for a pick is a visible warning, never a clean approval", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice()], { critique: async () => [] }),
  });
  assert.equal(response.results[0].reviewStatus, "REVIEW_REQUIRED");
});

test("revision runs at most once, only for a verified blocker", async () => {
  let revisions = 0;
  const record = notice();
  await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      revise: async (_profile, shortlist) => {
        revisions += 1;
        return shortlist;
      },
    }),
  });
  assert.equal(revisions, 0);
  await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      revise: async (_profile, shortlist) => {
        revisions += 1;
        return shortlist;
      },
      critique: async () => [
        {
          sourceId: record.id,
          verdict: "Bad",
          noneFound: false,
          findings: [
            {
              severity: "BLOCKER",
              issue: "Problem",
              why_it_matters: "x",
              evidence_source_id: record.id,
              exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
              proposed_correction: "Hold",
            },
          ],
        },
      ],
    }),
  });
  assert.equal(revisions, 1);
});

test("T11: an expired run budget stops with TIMEOUT instead of spinning", async () => {
  const controller = new AbortController();
  controller.abort();
  const budget = new RunBudget(controller.signal);
  assert.throws(
    () => budget.assertAvailable(),
    (error: unknown) => error instanceof MetaError && error.code === "TIMEOUT",
  );
  const exhausted = new RunBudget(undefined, 10);
  exhausted.record("analyst", { total_tokens: 11 });
  assert.throws(
    () => exhausted.assertAvailable(),
    (error: unknown) => error instanceof MetaError && error.code === "RATE_LIMITED",
  );
});

test("usage: tokens and calls are tracked per stage with an estimated cost", () => {
  const budget = new RunBudget();
  budget.record("planner", { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 });
  budget.record("planner", { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 });
  budget.record("scout", undefined);
  assert.equal(budget.tokens, 1_800);
  assert.deepEqual(budget.stages.planner, { calls: 2, inputTokens: 1_500, outputTokens: 300 });
  assert.equal(budget.stages.scout.calls, 1);
  assert.ok(Math.abs(budget.estimatedCostUsd - (1_500 * 1.25 + 300 * 4.25) / 1_000_000) < 1e-12);
});

test("usage: reaching the cost cap stops further model calls as RATE_LIMITED", () => {
  const budget = new RunBudget(undefined, 10_000_000, 0.01);
  budget.assertAvailable();
  budget.record("analyst", { prompt_tokens: 10_000, completion_tokens: 0, total_tokens: 10_000 });
  assert.throws(
    () => budget.assertAvailable(),
    (error: unknown) => error instanceof MetaError && error.code === "RATE_LIMITED" && /cost cap/.test(error.message),
  );
});

test("usage: the run log holds counts only and is written for failed runs too", async () => {
  const logged: string[] = [];
  const realInfo = console.info;
  console.info = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    await assert.rejects(
      runResearch(PROFILE, {
        deps: fakeDeps([notice()], {
          plan: async () => {
            throw new MetaError("UPSTREAM_ERROR", "test");
          },
        }),
      }),
    );
  } finally {
    console.info = realInfo;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /"outcome":"failed"/);
  assert.ok(!logged[0].includes(PROFILE.name));
  assert.ok(!logged[0].includes(PROFILE.capabilities));
});

test("T12: two runs give stable ids and no duplicates", async () => {
  const records = [notice(), notice(), award(), notice({ id: "TEST-NOTICE-2" })];
  const run = () =>
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps(dedupeRecords(records)),
    });
  const [first, second] = [await run(), await run()];
  const ids = (response: typeof first) => response.results.map((result) => result.record.id);
  assert.deepEqual(ids(first), ids(second));
  assert.equal(new Set(ids(first)).size, ids(first).length);
  assert.equal(dedupeRecords(records).length, 3);
});

test("agentEvents are real, in pipeline order, and a failed stage is logged and thrown", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice()]),
  });
  const started = response.agentEvents.filter((event) => event.status === "started").map((event) => event.step);
  assert.deepEqual(started, ["planner", "scout", "analyst", "strategist", "devils_advocate"]);

  await assert.rejects(
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps([notice()], {
        analyze: async () => {
          throw new MetaError("RATE_LIMITED", "Meta API rate limit reached");
        },
      }),
    }),
    (error: unknown) => error instanceof MetaError && error.code === "RATE_LIMITED",
  );
});

test("scoring clamps, keeps unknowns null, and historical never scores timing or eligibility", () => {
  const notices = computeFit(
    { technical: 99, category: -5, eligibility: null, execution: 4.4, timing: 10 },
    "open_notice",
  );
  assert.deepEqual(notices.fitBreakdown, { technical: 40, category: 0, eligibility: null, execution: 4, timing: 10 });
  assert.equal(notices.fitScore, 54);
  const past = computeFit({ technical: 30, category: 10, eligibility: 20, execution: 5, timing: 10 }, "historical_award");
  assert.equal(past.fitBreakdown.eligibility, null);
  assert.equal(past.fitBreakdown.timing, null);
  assert.equal(past.fitScore, 45);
  assert.equal(finalConfidence("high", "HOLD"), "low");
  assert.equal(finalConfidence("high", "REVIEW_REQUIRED"), "medium");
  assert.equal(finalConfidence("low", "APPROVED"), "low");
});

test("the Devil's Advocate prompt matches the runbook apart from its intended changes", () => {
  const runbook = readFileSync(new URL("../docs/runbook.md", import.meta.url), "utf8");
  const asInRunbook = DEVILS_ADVOCATE_PROMPT.replace("Rauros Systems' Devil's", "ContractRadar's Devil's").replace(
    "Missing data alone is never a BLOCKER.",
    "Missing data alone is a WARNING.",
  );
  for (const line of asInRunbook.split("\n").filter((line) => line && !line.startsWith("SEVERITY:"))) {
    assert.ok(runbook.includes(line), line.slice(0, 40));
  }
  assert.ok(!DEVILS_ADVOCATE_PROMPT.includes("ContractRadar"));
  assert.ok(DEVILS_ADVOCATE_PROMPT.includes("Never drop a real issue"));
});

const warning = (issue: string, overrides: Partial<AuditFinding> = {}): AuditFinding => ({
  severity: "WARNING",
  issue,
  whyItMatters: "Test",
  evidenceSourceId: null,
  evidenceExcerpt: null,
  correctiveAction: "Check the source.",
  ...overrides,
});

test("the warning cap demotes the critic's excess to NOTE and deletes nothing", () => {
  const critic = [warning("a"), warning("b"), warning("c"), warning("d")];
  const capped = capCriticWarnings(critic, new Set(critic));
  assert.deepEqual(capped.map((finding) => finding.issue), ["a", "b", "c", "d"]);
  assert.deepEqual(capped.map((finding) => finding.severity), ["WARNING", "WARNING", "NOTE", "NOTE"]);
});

test("the warning cap keeps the strongest critic warnings first", () => {
  const plain = warning("plain");
  const excerpt = warning("excerpt", { evidenceExcerpt: "text" });
  const unverified = warning("unverified contradiction", { correctiveAction: "Needs verification. Check it." });
  const critic = [plain, excerpt, unverified];
  const kept = capCriticWarnings(critic, new Set(critic)).filter((finding) => finding.severity === "WARNING");
  assert.deepEqual(kept.map((finding) => finding.issue), ["excerpt", "unverified contradiction"]);
});

test("the warning cap counts code warnings first and never demotes them or a BLOCKER", () => {
  const gate = [warning("gate 1"), warning("gate 2"), warning("gate 3")];
  const blocker = warning("blocker", { severity: "BLOCKER" });
  const critic = [blocker, warning("critic")];
  const capped = capCriticWarnings([...gate, ...critic], new Set(critic));
  assert.deepEqual(capped.map((finding) => finding.severity), ["WARNING", "WARNING", "WARNING", "BLOCKER", "NOTE"]);
});

test("the warning cap never changes the review status", () => {
  for (let count = 0; count <= 5; count += 1) {
    const critic = Array.from({ length: count }, (_, index) => warning(`w${index}`));
    assert.equal(statusFromFindings(capCriticWarnings(critic, new Set(critic))), statusFromFindings(critic));
  }
});

const samNotice = (id: string, overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  id,
  source: "sam",
  kind: "open_notice",
  title: "[TEST] Hydrophone assembly",
  agency: "[TEST] NAVSUP",
  url: `https://sam.gov/workspace/contract/opp/${id}/view`,
  retrievedAt: "2026-11-03T00:00:00.000Z",
  postedAt: "2026-11-02",
  solicitationNumber: "SOL-1",
  excerpts: [{ field: "title", text: "[TEST] Hydrophone assembly" }],
  ...overrides,
});

test("collapse: presolicitation and solicitation of one buy become one card", () => {
  const pre = samNotice("PRE", { kind: "early_stage_notice", postedAt: "2026-10-15" });
  const sol = samNotice("SOL");
  const [card, ...rest] = collapseNotices([pre, sol]);
  assert.equal(rest.length, 0);
  assert.equal(card.id, "SOL");
  assert.deepEqual(card.relatedNotices, [{ id: "PRE", kind: "early_stage_notice", postedAt: "2026-10-15", url: pre.url }]);
});

test("collapse: the latest solicitation wins and the number match ignores case and spacing", () => {
  const older = samNotice("OLD", { postedAt: "2026-10-01", solicitationNumber: "sol-1 " });
  const newer = samNotice("NEW", { postedAt: "2026-10-20" });
  const [card] = collapseNotices([older, newer]);
  assert.equal(card.id, "NEW");
  assert.deepEqual(card.relatedNotices?.map((related) => related.id), ["OLD"]);
});

test("collapse: an expired solicitation still wins, so its HOLD is not hidden by a presolicitation", () => {
  const expired = samNotice("SOL", { deadlineAt: "2026-01-15T17:00:00-05:00", postedAt: "2026-01-01" });
  const pre = samNotice("PRE", { kind: "early_stage_notice", deadlineAt: "2027-01-15", postedAt: "2026-12-01" });
  assert.equal(collapseNotices([pre, expired])[0].id, "SOL");
});

test("collapse: the same title under different numbers stays separate", () => {
  const records = [samNotice("A", { solicitationNumber: "SOL-A" }), samNotice("B", { solicitationNumber: "SOL-B" })];
  assert.deepEqual(collapseNotices(records), records);
});

test("collapse: without a number, only the same title and office merge", () => {
  const none = { solicitationNumber: null };
  const a = samNotice("A", none);
  const sameBuy = samNotice("B", { ...none, title: " [test]  hydrophone ASSEMBLY", postedAt: "2026-10-01" });
  const otherOffice = samNotice("C", { ...none, agency: "[TEST] DLA" });
  const numbered = samNotice("D");
  const out = collapseNotices([a, sameBuy, otherOffice, numbered]);
  assert.deepEqual(out.map((record) => record.id), ["A", "C", "D"]);
  assert.deepEqual(out[0].relatedNotices?.map((related) => related.id), ["B"]);
});

test("collapse: running again keeps related notices and leaves awards alone", () => {
  const award: SourceRecord = {
    ...samNotice("AWARD", { source: "usaspending", kind: "historical_award", solicitationNumber: null }),
    url: "https://www.usaspending.gov/award/AWARD",
  };
  const first = collapseNotices([samNotice("PRE", { kind: "early_stage_notice", postedAt: "2026-10-15" }), samNotice("SOL"), award]);
  const again = collapseNotices([...first, samNotice("LATER", { postedAt: "2026-11-05" })]);
  assert.equal(again.length, 2);
  const card = again.find((record) => record.source === "sam");
  assert.equal(card?.id, "LATER");
  assert.deepEqual(card?.relatedNotices?.map((related) => related.id).sort(), ["PRE", "SOL"]);
  assert.ok(again.includes(award));
});

test("descriptions: markup is removed, the key stays out of errors, and repeat runs reuse the text", async () => {
  clearDescriptionMemo();
  process.env.SAM_API_KEY = "secret-test-key";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return Response.json({ description: "<p>Source&nbsp;Control &amp; <b>First Article</b></p>" });
  }) as typeof fetch;
  const record = notice();
  const first = await describeNotices([record]);
  assert.equal(first.texts.get(record.id), "Source Control & First Article");
  assert.match(urls[0], /noticedesc\?noticeid=TEST-NOTICE-1/);
  await describeNotices([record]);
  assert.equal(urls.length, 1);

  clearDescriptionMemo();
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  const failed = await describeNotices([record]);
  assert.deepEqual(failed.unavailable, [record.id]);
});

test("descriptions: the first 429 stops further SAM calls", async () => {
  clearDescriptionMemo();
  process.env.SAM_API_KEY = "secret-test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 429 });
  };
  const records = [notice({ id: "A" }), notice({ id: "B" }), notice({ id: "C" })];
  const result = await describeNotices(records);
  assert.equal(calls, 1);
  assert.deepEqual(result.unavailable, ["A", "B", "C"]);
});

test("descriptions: long text is shortened and reported, a missing notice is unavailable", async () => {
  clearDescriptionMemo();
  process.env.SAM_API_KEY = "secret-test-key";
  globalThis.fetch = async () => Response.json({ description: "x".repeat(9_000) });
  const long = await describeNotices([notice({ id: "LONG" })]);
  assert.equal(long.texts.get("LONG")?.length, 8_000);
  assert.deepEqual(long.shortened, ["LONG"]);
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  assert.deepEqual((await describeNotices([notice({ id: "GONE" })])).unavailable, ["GONE"]);
});

test("descriptions: only shortlisted SAM notices are fetched, and the critic sees the text", async () => {
  const records = [notice({ id: "PICKED" }), notice({ id: "NOT-PICKED" }), award()];
  let asked: string[] = [];
  let seen: SourceRecord | undefined;
  const response = await runResearch(PROFILE, {
    deps: fakeDeps(records, {
      strategize: async () => [
        { sourceId: "PICKED", rationale: "Fits", nextSteps: ["Verify"] },
        { sourceId: award().id, rationale: "Buyer", nextSteps: ["Research"] },
      ],
      describe: async (targets) => {
        asked = targets.map((record) => record.id);
        return { texts: new Map([["PICKED", "Only approved sources"]]), unavailable: [], shortened: [] };
      },
      critique: async (_profile, list, _assessments, shortlist) => {
        seen = list.find((record) => record.id === "PICKED");
        return shortlist.map((pick) => ({ sourceId: pick.sourceId, verdict: "Checked", noneFound: true, findings: [] }));
      },
    }),
  });
  assert.deepEqual(asked, ["PICKED"]);
  assert.ok(seen?.excerpts.some((excerpt) => excerpt.field === "description" && excerpt.text === "Only approved sources"));
  const picked = response.results.find((result) => result.record.id === "PICKED");
  assert.equal(picked?.record.description, "Only approved sources");
  assert.ok(!picked?.findings.some((finding) => finding.issue.includes("description")));
});

test("descriptions: a failed fetch adds a NOTE, keeps the status and leaves the description null", async () => {
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([notice()], {
      describe: async (targets) => ({ texts: new Map(), unavailable: targets.map((record) => record.id), shortened: [] }),
    }),
  });
  const result = response.results[0];
  assert.equal(result.record.description, null);
  const note = result.findings.find((finding) => finding.issue === "SAM.gov description was not retrieved");
  assert.equal(note?.severity, "NOTE");
  assert.equal(result.reviewStatus, "APPROVED");
});

test("descriptions: nothing is fetched after a SAM.gov search failure", async () => {
  let called = false;
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([notice()], {
      scout: async () => scoutWith([notice()], { samFailure: "SAM.gov returned HTTP 429" }),
      describe: async () => {
        called = true;
        return { texts: new Map(), unavailable: [], shortened: [] };
      },
    }),
  });
  assert.equal(called, false);
  assert.ok(response.results[0].findings.some((finding) => finding.issue === "SAM.gov description was not retrieved"));
});

test("descriptions: off by default, so no SAM.gov calls unless SAM_DESCRIPTIONS is on", async () => {
  const describe: PipelineDeps["describe"] = async () => {
    throw new Error("must not fetch descriptions");
  };
  const realSwitch = process.env.SAM_DESCRIPTIONS;
  try {
    for (const value of [undefined, "off", "true"]) {
      if (value === undefined) delete process.env.SAM_DESCRIPTIONS;
      else process.env.SAM_DESCRIPTIONS = value;
      const deps = fakeDeps([notice()], { describe });
      delete deps.descriptionsEnabled; // Use the real switch.
      const response = await runResearch(PROFILE, { deps });
      const result = response.results[0];
      assert.equal(result.record.description, null);
      assert.ok(result.findings.some((finding) => finding.issue === "SAM.gov description was not retrieved"));
    }
    process.env.SAM_DESCRIPTIONS = "on";
    let called = false;
    const deps = fakeDeps([notice()], {
      describe: async () => {
        called = true;
        return { texts: new Map(), unavailable: [], shortened: [] };
      },
    });
    delete deps.descriptionsEnabled;
    await runResearch(PROFILE, { deps });
    assert.equal(called, true);
  } finally {
    if (realSwitch === undefined) delete process.env.SAM_DESCRIPTIONS;
    else process.env.SAM_DESCRIPTIONS = realSwitch;
  }
});

test("schemas keep the optional accuracy fields and still accept records without them", () => {
  const notice = {
    id: "TEST-NOTICE",
    source: "sam",
    kind: "open_notice",
    title: "[TEST] Notice",
    url: "https://sam.gov/workspace/contract/opp/TEST-NOTICE/view",
    retrievedAt: "2026-11-03T00:00:00.000Z",
    excerpts: [],
  };
  assert.ok(SourceRecordSchema.safeParse(notice).success);
  const fields = {
    solicitationNumber: "TEST-SOL",
    relatedNotices: [
      { id: "TEST-PRE", kind: "early_stage_notice", postedAt: "2026-10-01", url: "https://sam.gov/workspace/contract/opp/TEST-PRE/view" },
    ],
    recipient: null,
  };
  assert.deepEqual(SourceRecordSchema.parse({ ...notice, ...fields }), { ...notice, ...fields });
  assert.ok(!SourceRecordSchema.safeParse({ ...notice, relatedNotices: [{ ...fields.relatedNotices[0], url: "http://sam.gov/x" }] }).success);
});

test("the saved cache is valid, verbatim-shaped and only real-source historical records", () => {
  const cache = loadVerifiedRecords();
  assert.ok(cache);
  assert.ok(cache.records.length >= 10 && cache.records.length <= 20);
  for (const record of cache.records) {
    assert.ok(!record.title.includes("[TEST]") && !record.title.includes("[SAMPLE]"));
    assert.ok(record.url.endsWith(record.id));
    assert.equal(record.kind, "historical_award");
  }
});

// The OpenAI client keeps the fetch it first sees, so model traffic goes through a swappable handler.
let modelHandler: (body: Record<string, unknown>) => unknown = () => ({});
let modelCalls = 0;
const modelFetch: typeof fetch = async (_url, init) => {
  modelCalls += 1;
  const reply = modelHandler(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
};
function completion(message: Record<string, unknown>) {
  return {
    id: "test",
    object: "chat.completion",
    created: 0,
    model: "muse-spark-1.3",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", ...message } }],
    usage: { total_tokens: 10 },
  };
}
function useFakeModel(handler: typeof modelHandler) {
  process.env.MODEL_API_KEY ??= "test-key";
  modelHandler = handler;
  modelCalls = 0;
  globalThis.fetch = modelFetch;
}

test("T9: invalid output gets exactly one retry, then a graceful failure", async () => {
  const schema = z.object({ terms: z.array(z.string()) });
  const call = () =>
    chatJson({ stage: "planner", budget: new RunBudget(), schema, system: "s", user: "u" });

  useFakeModel(() => completion({ content: "not json" }));
  await assert.rejects(call(), (error: unknown) => error instanceof MetaError && error.code === "UPSTREAM_ERROR");
  assert.equal(modelCalls, 2);

  let attempts = 0;
  useFakeModel(() => {
    attempts += 1;
    return completion({ content: attempts === 1 ? "{bad" : '{"terms":["sonar"]}' });
  });
  assert.deepEqual(await call(), { terms: ["sonar"] });
  assert.equal(modelCalls, 2);
});

test("the scout stops at the tool-round cap and dedupes across rounds", async () => {
  delete process.env.SAM_API_KEY;
  let round = 0;
  useFakeModel((body) => {
    assert.equal(body.model, "muse-spark-1.3");
    round += 1;
    return completion({
      content: null,
      tool_calls: [
        {
          id: `call-${round}`,
          type: "function",
          function: { name: "search_awards", arguments: JSON.stringify({ keywords: [`term${round}`] }) },
        },
      ],
    });
  });
  const model = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("usaspending")) {
      return Response.json({
        results: [{ generated_internal_id: "CONT_AWD_SAME", Description: "[TEST] same award" }],
      });
    }
    return model(url, init);
  };
  const result = await runScout(PLAN, new RunBudget());
  assert.equal(result.turns, MAX_TOOL_TURNS);
  assert.equal(round, MAX_TOOL_TURNS);
  assert.equal(result.records.length, 1);
  assert.equal(result.toolCalls.length, MAX_TOOL_TURNS);
  assert.equal(result.modelDirected, true);
});

test("the scout says so when the model made no tool call, and offers no SAM tool without a key", async () => {
  delete process.env.SAM_API_KEY;
  useFakeModel((body) => {
    const tools = body.tools as { function: { name: string } }[];
    assert.deepEqual(tools.map((tool) => tool.function.name), ["search_awards"]);
    return completion({ content: "done" });
  });
  const model = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).includes("usaspending") ? Response.json({ results: [] }) : model(url, init);
  const result = await runScout(PLAN, new RunBudget());
  assert.equal(result.modelDirected, false);
  assert.equal(result.turns, 0);
});

const startFakeModel = useFakeModel; // Not a React hook, so this name keeps the hooks lint rule out of it.

type AwardFilters = { keywords: string[]; naics_codes?: string[]; psc_codes?: string[] };

// One scout round with a fake model, recording the USAspending filters it sends.
async function scoutWithCodes(
  categories: ResearchPlan["categories"],
  awardsFor: (filters: AwardFilters) => unknown[] | Response,
) {
  clearScoutMemo();
  delete process.env.SAM_API_KEY;
  let round = 0;
  startFakeModel(() => {
    round += 1;
    if (round > 1) return completion({ content: "done" });
    return completion({
      content: null,
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "search_awards", arguments: JSON.stringify({ keywords: ["hydrophone"] }) } },
      ],
    });
  });
  const seen: AwardFilters[] = [];
  const model = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("usaspending")) return model(url, init);
    const filters = (JSON.parse(String(init?.body)) as { filters: AwardFilters }).filters;
    seen.push(filters);
    const answer = awardsFor(filters);
    return answer instanceof Response ? answer : Response.json({ results: answer });
  };
  const result = await runScout({ ...PLAN, categories }, new RunBudget());
  return { result, seen };
}
const rawAward = (id: string) => ({ generated_internal_id: id, Description: `[TEST] ${id}` });
const NAICS = { scheme: "NAICS" as const, code: "334511", label: "test" };
const PSC = { scheme: "PSC" as const, code: "5845", label: "test" };

test("codes: each code gets its own search, plus one small keyword backup", async () => {
  const { result, seen } = await scoutWithCodes([NAICS, PSC], (filters) => {
    if (filters.naics_codes) return [rawAward("BY-NAICS")];
    if (filters.psc_codes) return [rawAward("BY-PSC")];
    return [rawAward("BY-KEYWORD")];
  });
  assert.ok(!seen.some((filters) => filters.naics_codes && filters.psc_codes), "both codes in one search returns almost nothing");
  assert.deepEqual(seen.map((filters) => filters.naics_codes ?? filters.psc_codes ?? "none"), [["334511"], ["5845"], "none"]);
  assert.deepEqual(result.records.map((record) => record.id), ["BY-NAICS", "BY-PSC", "BY-KEYWORD"]);
  assert.ok(result.toolCalls.some((call) => call.includes("keyword backup")));
});

test("codes: if they find nothing, the same keywords run without them", async () => {
  const { result } = await scoutWithCodes([NAICS], (filters) =>
    filters.naics_codes ? [] : [rawAward("FALLBACK")],
  );
  assert.deepEqual(result.records.map((record) => record.id), ["FALLBACK"]);
});

test("codes: one failed code search still keeps the other's results", async () => {
  const { result } = await scoutWithCodes([NAICS, PSC], (filters) =>
    filters.naics_codes ? new Response("{}", { status: 500 }) : [rawAward("KEPT")],
  );
  assert.ok(result.records.some((record) => record.id === "KEPT"));
  assert.equal(result.usaspendingSucceeded, true);
});

test("codes: malformed planner codes are ignored and no codes means no backup search", async () => {
  const { seen, result } = await scoutWithCodes(
    [{ scheme: "NAICS", code: "not a code", label: "test" }, { scheme: "PSC", code: "TOO-LONG", label: "test" }],
    () => [rawAward("PLAIN")],
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].naics_codes, undefined);
  assert.equal(seen[0].psc_codes, undefined);
  assert.ok(!result.toolCalls.some((call) => call.includes("keyword backup")));
});

test("codes: a SAM PSC search sends ccode and keeps only exact matches", async () => {
  process.env.SAM_API_KEY = "secret-test-key";
  let requested = "";
  const raw = (noticeId: string, classificationCode: string) => ({
    noticeId,
    title: `[TEST] ${noticeId}`,
    type: "Solicitation",
    active: "Yes",
    uiLink: `https://sam.gov/workspace/contract/opp/${noticeId}/view`,
    classificationCode,
  });
  globalThis.fetch = (async (url: string) => {
    requested = String(url);
    return Response.json({ opportunitiesData: [raw("MATCH", "5845"), raw("OTHER", "9999")] });
  }) as typeof fetch;
  const records = await searchNotices({ pscCode: "5845" });
  assert.match(requested, /ccode=5845/);
  assert.deepEqual(records.map((record) => record.id), ["MATCH"]);
});

const SAVED = {
  retrievedAt: "2026-11-03T23:00:00.000Z",
  records: [notice({ id: "SAVED-NOTICE", retrievedAt: "2026-11-03T23:00:00.000Z" })],
  descriptions: { "SAVED-NOTICE": "Saved scope text" },
  shortened: [],
};

test("snapshot: a 429 uses saved notices, labeled, with live awards and saved text", async () => {
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([award()], {
      scout: async () => scoutWith([award()], { samFailure: "SAM.gov returned HTTP 429", samThrottled: true }),
      loadSnapshot: () => SAVED,
    }),
  });
  assert.equal(response.dataMode, "cached");
  assert.deepEqual(response.cachedSources, ["sam"]);
  assert.ok(response.warnings.some((warning) => warning.includes("saved SAM.gov notices") && warning.includes(SAVED.retrievedAt)));
  const saved = response.results.find((result) => result.record.id === "SAVED-NOTICE");
  assert.equal(saved?.record.retrievedAt, SAVED.retrievedAt);
  assert.equal(saved?.record.description, "Saved scope text");
  assert.ok(response.results.some((result) => result.record.id === award().id));
});

test("snapshot: a missing key uses it too, and live awards are still confirmed at the source", async () => {
  let enriched = 0;
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([award()], {
      samConfigured: () => false,
      loadSnapshot: () => SAVED,
      enrich: async (record) => {
        enriched += 1;
        return record;
      },
    }),
  });
  assert.deepEqual(response.cachedSources, ["sam"]);
  assert.equal(enriched, 1);
  assert.ok(!response.warnings.some((warning) => warning.includes("historical awards only")));
});

test("snapshot: saved text is still used with the description switch off, without a fetch", async () => {
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([notice({ id: "SAVED-NOTICE" })], {
      descriptionsEnabled: () => false,
      describe: async () => {
        throw new Error("must not fetch descriptions");
      },
      loadSnapshot: () => SAVED,
    }),
  });
  assert.equal(response.dataMode, "live");
  assert.equal(response.results[0].record.description, "Saved scope text");
});

test("snapshot: a stale saved notice past its deadline is still HOLD", async () => {
  const stale = { ...SAVED, records: [notice({ id: "STALE", deadlineAt: "2026-01-15T17:00:00-05:00" })], descriptions: {} };
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([], { samConfigured: () => false, loadSnapshot: () => stale }),
  });
  assert.equal(response.results[0].reviewStatus, "HOLD");
});

test("snapshot: other SAM errors, a working SAM and other profiles do not use it", async () => {
  const other = await runResearch(PROFILE, {
    deps: fakeDeps([award()], {
      scout: async () => scoutWith([award()], { samFailure: "SAM.gov returned HTTP 500" }),
      loadSnapshot: () => SAVED,
    }),
  });
  assert.equal(other.dataMode, "live");
  assert.equal(other.cachedSources, undefined);
  assert.ok(other.warnings.some((warning) => warning.includes("HTTP 500")));

  const working = await runResearch(PROFILE, {
    deps: fakeDeps([notice()], { loadSnapshot: () => SAVED }),
  });
  assert.equal(working.dataMode, "live");
  assert.ok(!working.results.some((result) => result.record.id === "SAVED-NOTICE"));

  assert.equal(loadSamSnapshot("[TEST] A profile with no capture"), null);
  const unknown = await runResearch(PROFILE, {
    deps: fakeDeps([award()], {
      samConfigured: () => false,
      loadSnapshot: loadSamSnapshot,
    }),
  });
  assert.equal(unknown.dataMode, "live");
  assert.ok(unknown.warnings.some((warning) => warning.includes("historical awards only")));
});

test("snapshot: a live notice wins over its saved copy, and a failed description fetch uses saved text", async () => {
  const live = notice({ id: "SAVED-NOTICE", title: "[TEST] Live title" });
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([live], {
      scout: async () => scoutWith([live], { samFailure: "SAM.gov returned HTTP 429", samThrottled: true }),
      loadSnapshot: () => SAVED,
    }),
  });
  assert.equal(response.results[0].record.title, "[TEST] Live title");

  const partial = await runResearch(PROFILE, {
    deps: fakeDeps([notice({ id: "SAVED-NOTICE" })], {
      describe: async (targets) => ({ texts: new Map(), unavailable: targets.map((record) => record.id), shortened: [] }),
      loadSnapshot: () => SAVED,
    }),
  });
  assert.equal(partial.dataMode, "live");
  assert.equal(partial.results[0].record.description, "Saved scope text");
});

const ranked = (id: string, overrides: Partial<SourceRecord> = {}, reviewStatus: RankedResult["reviewStatus"] = "APPROVED") =>
  ({ record: notice({ id, ...overrides }), reviewStatus }) as RankedResult;

test("eval: precision counts labeled records only and reports unlabeled ones separately", () => {
  const file = EvalFileSchema.parse({
    profile: "[TEST]",
    source: "hand_label",
    labels: [
      { id: "A", label: "relevant" },
      { id: "B", label: "not_relevant" },
      { id: "LATER", label: "relevant" },
    ],
  });
  const m = computeMetrics(file, ["A", "B", "X", "Y", "Z", "LATER"].map((id) => ranked(id)), NOW);
  assert.equal(m.precisionAt5, 0.5);
  assert.equal(m.top5Unlabeled, 3);
  assert.equal(m.recallAt10, 1);
});

test("eval: no labeled record in the top 5 is unknown, not zero", () => {
  const file = EvalFileSchema.parse({ profile: "[TEST]", source: "award_history", relevantIds: ["A"] });
  const m = computeMetrics(file, [ranked("X")], NOW);
  assert.equal(m.precisionAt5, null);
  assert.equal(m.recallAt10, 0);
});

test("eval: expired notices count against HOLD, and none is n/a rather than 100%", () => {
  const file = EvalFileSchema.parse({ profile: "[TEST]", source: "hand_label", labels: [] });
  const past = { deadlineAt: "2026-01-15T17:00:00-05:00" };
  const m = computeMetrics(file, [ranked("A", past, "HOLD"), ranked("B", past, "REVIEW_REQUIRED")], NOW);
  assert.equal(m.expiredHoldRate, 0.5);
  assert.equal(computeMetrics(file, [ranked("C")], NOW).expiredHoldRate, null);
});

test("eval: the committed label files are valid", () => {
  const file = EvalFileSchema.parse(JSON.parse(readFileSync(new URL("../data/eval/aquavector.json", import.meta.url), "utf8")));
  assert.equal(file.labels?.length, 20);
  assert.equal(file.labels?.filter((entry) => entry.label === "relevant").length, 8);
});

const awardDetail = (overrides: Record<string, unknown> = {}) =>
  Response.json({
    generated_unique_award_id: "CONT_AWD_TEST_1",
    description: "[TEST] Hydrophone delivery order",
    awarding_agency: { toptier_agency: { name: "[TEST] Department of the Navy" } },
    ...overrides,
  });
const describedAward = () => award({ description: "[TEST] Hydrophone delivery order" });

test("identity: a matching award passes, ignoring case and spacing", async () => {
  globalThis.fetch = async () => awardDetail({ description: "  [test]  HYDROPHONE delivery order" });
  const findings = await verifyRecords([describedAward()]);
  assert.deepEqual(findings.get(describedAward().id), []);
});

test("identity: a different title, agency, id or a 404 is a BLOCKER", async () => {
  for (const [answer, expected] of [
    [() => awardDetail({ description: "[TEST] Janitorial services" }), /title/],
    [() => awardDetail({ awarding_agency: { toptier_agency: { name: "[TEST] Department of Labor" } } }), /agency/],
    [() => awardDetail({ generated_unique_award_id: "CONT_AWD_OTHER" }), /different award id/],
    [() => new Response("{}", { status: 404 }), /does not know/],
  ] as const) {
    globalThis.fetch = async () => answer();
    const [finding] = (await verifyRecords([describedAward()])).get(describedAward().id) ?? [];
    assert.equal(finding?.severity, "BLOCKER");
    assert.match(finding?.issue ?? "", expected);
  }
});

test("identity: a failed check is only a NOTE", async () => {
  for (const answer of [
    async () => new Response("{}", { status: 500 }),
    async () => {
      throw new TypeError("network down");
    },
    async () => new Response("not json"),
  ]) {
    globalThis.fetch = answer;
    const [finding] = (await verifyRecords([describedAward()])).get(describedAward().id) ?? [];
    assert.equal(finding?.severity, "NOTE");
  }
});

test("identity: SAM notices use no quota by default and a wrong link is a BLOCKER", async () => {
  delete process.env.SAM_IDENTITY_LOOKUPS;
  globalThis.fetch = async () => {
    throw new Error("must not call SAM.gov");
  };
  const good = notice({ id: "NOTICE-1", url: "https://sam.gov/workspace/contract/opp/NOTICE-1/view" });
  assert.deepEqual((await verifyRecords([good])).get("NOTICE-1"), []);
  const wrong = notice({ id: "NOTICE-2", url: "https://sam.gov/workspace/contract/opp/OTHER/view" });
  assert.equal((await verifyRecords([wrong])).get("NOTICE-2")?.[0].severity, "BLOCKER");
});

test("identity: with lookups on, SAM title differences are a BLOCKER", async () => {
  process.env.SAM_IDENTITY_LOOKUPS = "on";
  process.env.SAM_API_KEY = "secret-test-key";
  try {
    const id = "NOTICE-3";
    const uiLink = `https://sam.gov/workspace/contract/opp/${id}/view`;
    let requested = "";
    globalThis.fetch = (async (url: string) => {
      requested = String(url);
      return Response.json({ opportunitiesData: [{ noticeId: id, title: "[TEST] Other", type: "Solicitation", active: "Yes", uiLink }] });
    }) as typeof fetch;
    const findings = await verifyRecords([notice({ id, url: uiLink })]);
    assert.match(requested, /noticeid=NOTICE-3/);
    assert.match(findings.get(id)?.[0].issue ?? "", /title/);
  } finally {
    delete process.env.SAM_IDENTITY_LOOKUPS;
  }
});

test("identity: only shortlisted records are checked, and a mismatch means HOLD", async () => {
  let checked: string[] = [];
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([notice({ id: "PICKED" }), notice({ id: "OTHER" })], {
      strategize: async () => [{ sourceId: "PICKED", rationale: "Fits", nextSteps: ["Verify"] }],
      verify: async (records) => {
        checked = records.map((record) => record.id);
        return new Map(records.map((record) => [record.id, [{
          severity: "BLOCKER" as const,
          issue: "Record identity mismatch: test",
          whyItMatters: "Test",
          evidenceSourceId: record.id,
          evidenceExcerpt: null,
          correctiveAction: "Test",
        }]]));
      },
    }),
  });
  assert.deepEqual(checked, ["PICKED"]);
  assert.equal(response.results.find((result) => result.record.id === "PICKED")?.reviewStatus, "HOLD");
});

const buyerNotice = (overrides: Partial<SourceRecord> = {}) =>
  notice({
    title: "58--HYDROPHONE ASSEMBLY- AND SIMILAR REPLACEMENT PARTS",
    agency: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP",
    excerpts: [{ field: "classificationCode", text: "5845" }],
    ...overrides,
  });
const pastAward = (id: string, Description: string, overrides: Record<string, unknown> = {}) => ({
  generated_internal_id: id,
  Description,
  "Recipient Name": "[TEST] Supplier",
  "Award Amount": 1000,
  "Start Date": "2026-01-01",
  ...overrides,
});

test("buyer history: agency paths and title words become search terms", () => {
  assert.equal(subtierFromPath("DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP"), "Department of the Navy");
  assert.equal(subtierFromPath("DEPT OF DEFENSE.DEFENSE LOGISTICS AGENCY.DLA MARITIME"), "Defense Logistics Agency");
  assert.equal(subtierFromPath("DEPT OF DEFENSE"), null);
  assert.deepEqual(titleTerms("58--HYDROPHONE ASSEMBLY- AND SIMILAR REPLACEMENT PARTS"), ["HYDROPHONE"]);
  assert.deepEqual(titleTerms("DT-511C and DT-592D Hydrophones and Spare Parts"), ["DT-511C", "DT-592D", "Hydrophones"]);
});

test("buyer history: filters by buyer, PSC and words, and keeps only comparable past awards", async () => {
  let filters: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    filters = (JSON.parse(String(init.body)) as { filters: Record<string, unknown> }).filters;
    return Response.json({
      results: [
        pastAward("MATCH", "DT-574 HYDROPHONES, 25 FT"),
        pastAward("LOOSE", "MICROHYDROPHONE SYSTEM"),
        pastAward("FUTURE", "HYDROPHONE ORDER", { "Start Date": "2027-06-30" }),
        pastAward("TOO-OLD", "HYDROPHONE ORDER", { "Start Date": "2017-07-17" }),
        pastAward("NO-ID", "HYDROPHONE ORDER", { generated_internal_id: null }),
      ],
    });
  }) as typeof fetch;
  const awards = await findPriorAwards(buyerNotice(), NOW);
  assert.deepEqual(filters.psc_codes, ["5845"]);
  assert.deepEqual(filters.agencies, [{ type: "awarding", tier: "subtier", name: "Department of the Navy" }]);
  assert.deepEqual(awards, [
    {
      id: "MATCH",
      title: "DT-574 HYDROPHONES, 25 FT",
      recipient: "[TEST] Supplier",
      amount: 1000,
      date: "2026-01-01",
      url: "https://www.usaspending.gov/award/MATCH",
    },
  ]);
});

test("buyer history: missing inputs or any failure returns nothing, without a call when inputs are missing", async () => {
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  assert.deepEqual(await findPriorAwards(buyerNotice({ excerpts: [] }), NOW), []);
  assert.deepEqual(await findPriorAwards(buyerNotice({ agency: "DEPT OF DEFENSE" }), NOW), []);
  assert.deepEqual(await findPriorAwards(buyerNotice({ title: "SPARE PARTS" }), NOW), []);
  assert.deepEqual(await findPriorAwards(buyerNotice(), NOW), []);
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  assert.deepEqual(await findPriorAwards(buyerNotice(), NOW), []);
  globalThis.fetch = async () => Response.json({ results: "bad" });
  assert.deepEqual(await findPriorAwards(buyerNotice(), NOW), []);
});

test("buyer history: shortlisted notices get priorAwards, others have no field and status is unchanged", async () => {
  const prior = { id: "P", title: "[TEST] Past", recipient: null, amount: null, date: null, url: "https://www.usaspending.gov/award/P" };
  const response = await runResearch(PROFILE, {
    deps: fakeDeps([notice({ id: "PICKED" }), notice({ id: "OTHER" })], {
      strategize: async () => [{ sourceId: "PICKED", rationale: "Fits", nextSteps: ["Verify"] }],
      history: async () => new Map([["PICKED", [prior]], ["OTHER", [prior]]]),
    }),
  });
  const picked = response.results.find((result) => result.record.id === "PICKED");
  const other = response.results.find((result) => result.record.id === "OTHER");
  assert.deepEqual(picked?.priorAwards, [prior]);
  assert.equal(picked?.reviewStatus, "APPROVED");
  assert.ok(!(other && "priorAwards" in other));
});

test("awards record who won", () => {
  const record = normalizeAward({ generated_internal_id: "X", "Recipient Name": "[TEST] Supplier" }, "2026-11-03T00:00:00.000Z");
  assert.equal(record?.recipient, "[TEST] Supplier");
});

test("usage: the run log counts SAM.gov requests and 429s, separately per concurrent run", async () => {
  process.env.SAM_API_KEY = "secret-test-key";
  const logged: string[] = [];
  const realInfo = console.info;
  console.info = (...args: unknown[]) => void logged.push(args.join(" "));
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  const scoutCalling = (calls: number) => async () => {
    for (let call = 0; call < calls; call += 1) await searchNotices({ title: "hydrophone" }).catch(() => undefined);
    return scoutWith([notice()], { samFailure: "SAM.gov returned HTTP 429", samThrottled: true });
  };
  try {
    await Promise.all([
      runResearch(PROFILE, { deps: fakeDeps([notice()], { scout: scoutCalling(2) }) }),
      runResearch(PROFILE, { deps: fakeDeps([notice()], { scout: scoutCalling(1) }) }),
      runResearch(PROFILE, { deps: fakeDeps([notice()]) }),
    ]);
  } finally {
    console.info = realInfo;
  }
  const sam = logged.map((line) => (JSON.parse(line.replace("research run ", "")) as { sam: { requests: number; throttled: boolean } }).sam);
  assert.deepEqual(sam.map((usage) => usage.requests).sort(), [0, 1, 2]);
  assert.equal(sam.find((usage) => usage.requests === 0)?.throttled, false);
  assert.equal(sam.find((usage) => usage.requests === 2)?.throttled, true);
});
